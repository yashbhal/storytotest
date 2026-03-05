import * as fs from "fs";
import * as path from "path";
import { detectFramework, TestFramework } from "../core/frameworkDetector";
import { indexCodebase } from "../core/codebaseIndexer";
import { parseStory } from "../core/storyParser";
import { searchComponents, SearchResult } from "../core/componentSearch";
import { validateAndFixTest } from "../core/testValidator";
import { resolveImport } from "../core/importResolver";
import { generateTest } from "../core/testGenerator";
import {
  getDefaultModelForProvider,
  LLMProvider,
  normalizeProvider,
} from "../llm/provider";
import {
  GitHubClient,
  ExistingPRInfo,
  CreateTestPRResult,
} from "./githubClient";
import { envBool } from "./envHelper";

export interface WorkflowConfig {
  workspaceRoot: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  llmApiKey: string;
  llmProvider?: LLMProvider;
  llmModel?: string;
  llmBaseUrl?: string;
  baseBranch?: string;
  maxAttempts?: number;
  testOutputDir?: string;
  dryRun?: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
}

export interface WorkflowResult {
  success: boolean;
  prUrl?: string;
  error?: string;
}

interface WorkflowValidationResult {
  code: string;
  fileName: string;
  attempts: number;
  passed: boolean;
  lastError: string | null;
  skipped: boolean;
  framework: TestFramework;
}

/**
 * Main workflow orchestrator that processes a GitHub issue and generates tests.
 * 
 * @param issue - GitHub issue containing the user story
 * @param config - Workflow configuration (tokens, paths, LLM settings)
 * @returns Result with success status and PR URL if successful
 * 
 * @example
 * ```typescript
 * const result = await processGitHubIssue(
 *   { number: 42, title: "Add tests", body: "...", html_url: "..." },
 *   { workspaceRoot: "/path", githubToken: "...", ... }
 * );
 * ```
 */
export async function processGitHubIssue(
  issue: GitHubIssue,
  config: WorkflowConfig,
): Promise<WorkflowResult> {
  const log = (step: string, msg: string) =>
    console.log(`[issue #${issue.number}][${step}] ${msg}`);

  const client = new GitHubClient({
    token: config.githubToken,
    owner: config.githubOwner,
    repo: config.githubRepo,
    dryRun: config.dryRun,
  });

  try {
    // ============================================================
    // STEP 1: Extract Story from Issue
    // ============================================================
    log("start", `Processing: ${issue.title}${config.dryRun ? " (dry-run)" : ""}`);
    const storyText = [issue.title, issue.body ?? ""].join("\n").trim();

    // ============================================================
    // STEP 2: Detect Test Framework
    // ============================================================
    log("detect", `workspace: ${config.workspaceRoot}`);
    let framework = detectFramework(config.workspaceRoot);
    log("detect", `framework: ${framework}`);

    if (framework === "unknown" && envBool("ALLOW_SCAFFOLD_VITEST")) {
      log("scaffold", "No framework detected — scaffolding minimal Vitest config");
      scaffoldVitest(config.workspaceRoot);
      framework = "vitest";
    } else if (framework === "unknown") {
      log("detect", "No framework detected (set ALLOW_SCAFFOLD_VITEST=true to auto-scaffold)");
    }

    const shouldValidate = framework === "jest" || framework === "vitest";
    const provider = normalizeProvider(config.llmProvider, "openai");
    const model = config.llmModel || getDefaultModelForProvider(provider);
    const baseUrl = config.llmBaseUrl;

    // ============================================================
    // STEP 3: Index Codebase
    // ============================================================
    log("index", "Indexing codebase");
    const codebaseIndex = await indexCodebase(config.workspaceRoot);

    // ============================================================
    // STEP 4: Parse Story Entities
    // ============================================================
    log("parse", "Parsing story entities");
    const parsedStory = parseStory(storyText);
    log("parse", `entities: ${parsedStory.entities.join(", ")}`);

    // ============================================================
    // STEP 5: Search for Matching Components
    // ============================================================
    log("search", "Searching for matching components");
    const searchResults = searchComponents(codebaseIndex, parsedStory.entities);
    log("search", `Matched ${searchResults.matchedInterfaces.length} interfaces, ${searchResults.matchedClasses.length} classes`);

    if (
      searchResults.matchedInterfaces.length === 0 &&
      searchResults.matchedClasses.length === 0
    ) {
      const message = "No matching components found; skipping PR creation.";
      log("search", message);
      await client.commentOnIssue(
        issue.number,
        [
          message,
          "",
          "Story parsed entities:",
          parsedStory.entities.length ? parsedStory.entities.join(", ") : "<none>",
        ].join("\n"),
      );
      return { success: false, error: message };
    }

    // ============================================================
    // STEP 6-7: Generate and Validate Test Code
    // ============================================================
    const outputDir = normalizeOutputDir(config.testOutputDir);
    const testDir = path.join(config.workspaceRoot, outputDir);
    const imports = searchResults.matchedInterfaces
      .filter((iface) => iface.isExported)
      .map((iface) => resolveImport(iface, testDir));

    log("generate", "Generating and validating tests");

    const missingDeps = shouldValidate
      ? detectMissingValidationDeps(config.workspaceRoot, framework)
      : [];

    let validationResult: WorkflowValidationResult;

    if (shouldValidate && missingDeps.length === 0) {
      validationResult = {
        ...(await validateAndFixTest({
          apiKey: config.llmApiKey,
          model,
          provider,
          baseUrl,
          userStory: storyText,
          searchResults,
          testDir,
          framework,
          imports,
          workspacePath: config.workspaceRoot,
          maxAttempts: config.maxAttempts ?? 3,
        })),
        skipped: false,
        framework,
      };
    } else {
      if (missingDeps.length > 0) {
        log("validate", `Skipping — missing deps: ${missingDeps.join(", ")}`);
      }
      const generated = await generateWithoutValidation({
        apiKey: config.llmApiKey,
        model,
        provider,
        baseUrl,
        userStory: storyText,
        searchResults,
        testDir,
        framework,
        imports,
      });
      validationResult = missingDeps.length > 0
        ? { ...generated, lastError: `Missing validation deps: ${missingDeps.join(", ")}` }
        : generated;
    }

    log("validate", `passed=${validationResult.passed}, attempts=${validationResult.attempts}`);

    // ============================================================
    // STEP 8: Prepare Branch and File Paths
    // ============================================================
    let branchName = `test/issue-${issue.number}`;
    const testFilePath = path.posix.join(outputDir, validationResult.fileName);

    // ============================================================
    // STEP 9-10: Create/Update PR with Test File
    // ============================================================
    const prTitle = `Tests for issue #${issue.number}: ${issue.title}`;
    const prBody = buildPRBody(issue, validationResult, searchResults);

    // Reuse PR if one already exists for this issue
    const existingPr: ExistingPRInfo | null = await client.findExistingPR({ issueNumber: issue.number });
    let prUrl: string | null = existingPr?.url || null;
    let prHeadSha: string | undefined = existingPr?.headSha;
    let prNumber: number | undefined = existingPr?.number;
    if (existingPr?.headRef) {
      branchName = existingPr.headRef;
    }

    if (prUrl) {
      // Update existing branch with new test content
      log("pr", `Updating existing PR: ${prUrl}`);
      const branchExists = await client.findBranch(branchName);
      if (!branchExists) {
        // Fall back to creating branch from base
        const base = config.baseBranch || "main";
        let baseSHA: string;
        try {
          baseSHA = await client.getDefaultBranchSHA(base);
        } catch (err: any) {
          if (base !== "master") {
            baseSHA = await client.getDefaultBranchSHA("master");
          } else {
            throw err;
          }
        }
        await client.createBranch(branchName, baseSHA);
      }
      await client.commitFile(
        branchName,
        testFilePath,
        validationResult.code,
        `Update generated tests for issue #${issue.number}`,
      );

      // Refresh head SHA for check runs
      prHeadSha = await client.getBranchHeadSHA(branchName);
    } else {
      log("pr", `Creating PR on branch: ${branchName}`);
      const pr: CreateTestPRResult = await client.createTestPR({
        issueNumber: issue.number,
        branchName,
        filePath: testFilePath,
        fileContent: validationResult.code,
        prTitle,
        prBody,
        baseBranch: config.baseBranch,
      });
      prUrl = pr.url;
      prHeadSha = pr.headSha;
      prNumber = pr.number;
    }

    // ============================================================
    // STEP 11: Add Label to PR
    // ============================================================
    if (prNumber) {
      try {
        log("label", "Adding 'tests-generated' label");
        await client.addLabel({ prNumber, label: "tests-generated" });
      } catch (labelErr: any) {
        log("label", `Failed: ${labelErr?.message}`);
      }
    }

    // ============================================================
    // STEP 12: Create Check Run (Optional)
    // ============================================================
    const useCheckRuns = envBool("USE_CHECK_RUNS");
    if (!useCheckRuns) {
      log("check", "Skipping check run (PAT or checks disabled)");
    } else if (prHeadSha && validationResult.passed) {
      const summary = validationResult.skipped
        ? `Validation skipped for ${validationResult.framework}`
        : `Validation passed in ${validationResult.attempts} attempt(s)`;
      const details = !validationResult.skipped && validationResult.lastError
        ? formatErrorSnippet(validationResult.lastError)
        : undefined;
      try {
        log("check", "Creating check run");
        await client.createCheckRun({
          name: "StoryToTest",
          headSha: prHeadSha,
          conclusion: "success",
          summary,
          details,
        });
      } catch (checkErr: any) {
        log("check", `Failed: ${checkErr?.message}`);
      }
    } else {
      log("check", "Skipping (validation did not pass)");
    }

    // ============================================================
    // STEP 13: Comment on Issue with Results
    // ============================================================
    log("comment", "Posting results to issue");
    const issueComment = buildIssueComment(prUrl || "", validationResult, searchResults);
    await client.commentOnIssue(issue.number, issueComment);

    log("done", "Workflow completed successfully");
    return { success: true, prUrl };
  } catch (err: any) {
    const errorMessage = err?.message ?? "Unknown error";
    log("error", `Workflow failed: ${errorMessage}`);

    try {
      await client.commentOnIssue(
        issue.number,
        `Test generation failed: ${errorMessage}`,
      );
    } catch (commentErr: any) {
      log("error", `Failed to post error comment: ${commentErr?.message}`);
    }

    return { success: false, error: errorMessage };
  }
}

function buildPRBody(
  issue: GitHubIssue,
  validationResult: WorkflowValidationResult,
  searchResults: SearchResult,
): string {
  const validationStatus = validationResult.skipped
    ? `⏭️ Skipped for framework \`${validationResult.framework}\``
    : validationResult.passed
      ? `✅ Passed after ${validationResult.attempts} attempt(s)`
      : `❌ Did not pass after ${validationResult.attempts} attempt(s)`;

  const errorSection =
    validationResult.skipped || validationResult.passed || !validationResult.lastError
      ? ""
      : `\n\n<details><summary>Last validation error</summary>\n\n${formatErrorSnippet(validationResult.lastError)}\n\n</details>`;

  const componentNames = formatComponentNames(searchResults);

  return [
    `## Auto-generated Tests`,
    ``,
    `This PR was automatically generated from issue #${issue.number}.`,
    ``,
    `**Issue:** [${issue.title}](${issue.html_url})`,
    ``,
    `**Validation:** ${validationStatus}` + errorSection,
    ``,
    `### Matched Components`,
    ``,
    componentNames || "_None_",
    ``,
    `### Issue Description`,
    ``,
    issue.body ?? "_No description provided._",
  ].join("\n");
}

function buildIssueComment(
  prUrl: string,
  validationResult: WorkflowValidationResult,
  searchResults: SearchResult,
): string {
  const status = validationResult.skipped
    ? `generated (validation skipped for \`${validationResult.framework}\`)`
    : validationResult.passed
      ? "passed validation"
      : "generated (validation did not pass)";

  const componentNames = formatComponentNames(searchResults);

  const validationSummary = validationResult.skipped
    ? `⏭️ Skipped (${validationResult.attempts} attempt)`
    : validationResult.passed
      ? `✅ Passed (${validationResult.attempts} attempt(s))`
      : `❌ Failed (${validationResult.attempts} attempt(s))`;

  const errorSnippet = !validationResult.skipped && !validationResult.passed && validationResult.lastError
    ? [``, `**Last error:**`, formatErrorSnippet(validationResult.lastError)].join("\n")
    : "";

  return [
    `Tests have been ${status} and a pull request has been created.`,
    ``,
    `**PR:** ${prUrl}`,
    componentNames ? `**Matched:** ${componentNames}` : "",
    `**Validation:** ${validationSummary}`,
    errorSnippet,
  ].filter(Boolean).join("\n");
}

function formatComponentNames(searchResults: SearchResult): string {
  const parts: string[] = [];
  const ifaceNames = searchResults.matchedInterfaces.map((i) => i.name);
  const classNames = searchResults.matchedClasses.map((c) => c.name);
  if (ifaceNames.length > 0) {
    parts.push(`${ifaceNames.join(", ")} (interfaces)`);
  }
  if (classNames.length > 0) {
    parts.push(`${classNames.join(", ")} (classes)`);
  }
  return parts.join("; ");
}

function formatErrorSnippet(error: string): string {
  const trimmed = error.trim();
  const lines = trimmed.split(/\r?\n/).slice(0, 20); // cap length for readability
  return "```\n" + lines.join("\n") + "\n```";
}

async function generateWithoutValidation(params: {
  apiKey: string;
  model: string;
  provider: LLMProvider;
  baseUrl?: string;
  userStory: string;
  searchResults: ReturnType<typeof searchComponents>;
  testDir: string;
  framework: TestFramework;
  imports: string[];
}): Promise<WorkflowValidationResult> {
  const generated = await generateTest(
    params.apiKey,
    params.userStory,
    params.searchResults.matchedInterfaces,
    params.searchResults.matchedClasses,
    params.testDir,
    params.framework,
    params.imports,
    "Validation is skipped for this framework. Focus on generating a runnable test file.",
    params.model,
    { provider: params.provider, baseUrl: params.baseUrl },
  );

  return {
    code: generated.code,
    fileName: generated.fileName,
    attempts: 1,
    passed: false,
    lastError: null,
    skipped: true,
    framework: params.framework,
  };
}

function scaffoldVitest(workspacePath: string): void {
  const configPath = path.join(workspacePath, "vitest.config.ts");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      [
        `import { defineConfig } from "vitest/config";`,
        ``,
        `export default defineConfig({`,
        `  test: {`,
        `    globals: true,`,
        `  },`,
        `});`,
        ``,
      ].join("\n"),
      "utf-8",
    );
  }

  const setupDir = path.join(workspacePath, "test");
  const setupPath = path.join(setupDir, "setupTests.ts");
  if (!fs.existsSync(setupPath)) {
    if (!fs.existsSync(setupDir)) {
      fs.mkdirSync(setupDir, { recursive: true });
    }
    fs.writeFileSync(
      setupPath,
      `// Minimal setup file scaffolded by StoryToTest\n`,
      "utf-8",
    );
  }
}

function detectMissingValidationDeps(
  workspacePath: string,
  framework: TestFramework,
): string[] {
  const missing: string[] = [];
  const pkgPath = path.join(workspacePath, "package.json");
  let pkg: any = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return missing;
  }

  const hasDep = (name: string) =>
    Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);

  const hasReact = hasDep("react");

  // Vitest needs jsdom or happy-dom for DOM/React component tests
  if (framework === "vitest" && hasReact && !hasDep("jsdom") && !hasDep("happy-dom")) {
    missing.push("jsdom (or happy-dom)");
  }

  // React projects need @testing-library/react for component tests
  if (hasReact && !hasDep("@testing-library/react")) {
    missing.push("@testing-library/react");
  }

  return missing;
}

function normalizeOutputDir(outputDir?: string): string {
  const fallback = "__tests__";
  const candidate = (outputDir ?? fallback).trim();
  if (!candidate) {
    return fallback;
  }

  const withoutDrive = candidate.replace(/^[A-Za-z]:/, "");
  const withForwardSlashes = withoutDrive.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(withForwardSlashes);

  if (normalized === "." || normalized.startsWith("../")) {
    return fallback;
  }

  return normalized;
}

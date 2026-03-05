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
    const storyText = buildStoryText(issue, config, log);
    const frameworkInfo = determineFramework(config, log);
    const llmConfig = prepareLLMConfig(config);

    const context = await collectContextForIssue({
      config,
      storyText,
      log,
    });

    const hasMatches =
      context.searchResults.matchedInterfaces.length > 0 ||
      context.searchResults.matchedClasses.length > 0;

    if (!hasMatches) {
      return await handleNoMatches(issue, client, context.parsedStory, log);
    }

    const validationResult = await generateAndValidate({
      issue,
      config,
      storyText,
      frameworkInfo,
      llmConfig,
      context,
      log,
    });

    const prOutcome = await upsertPullRequest({
      issue,
      config,
      client,
      validationResult,
      searchResults: context.searchResults,
      log,
    });

    await maybeLabelPullRequest({ client, prNumber: prOutcome.prNumber, log });
    await maybeCreateCheckRun({
      client,
      validationResult,
      prHeadSha: prOutcome.prHeadSha,
      log,
    });

    await commentOnIssueWithResults({
      client,
      issue,
      prUrl: prOutcome.prUrl,
      validationResult,
      searchResults: context.searchResults,
      log,
    });

    log("done", "Workflow completed successfully");
    return { success: true, prUrl: prOutcome.prUrl || undefined };
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

/**
 * Build the story text from the GitHub issue title and body.
 * 
 * @param issue - GitHub issue
 * @param config - Workflow configuration
 * @param log - Logging function
 * @returns Story text
 */
function buildStoryText(
  issue: GitHubIssue,
  config: WorkflowConfig,
  log: (step: string, msg: string) => void,
): string {
  log("start", `Processing: ${issue.title}${config.dryRun ? " (dry-run)" : ""}`);
  return [issue.title, issue.body ?? ""].join("\n").trim();
}

/**
 * Detect the repository's test framework and decide whether validation should run.
 * 
 * @param config - Workflow configuration
 * @param log - Logging function
 * @returns Framework information
 */
function determineFramework(
  config: WorkflowConfig,
  log: (step: string, msg: string) => void,
): { framework: TestFramework; shouldValidate: boolean } {
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
  return { framework, shouldValidate };
}

function prepareLLMConfig(config: WorkflowConfig): {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
} {
  const provider = normalizeProvider(config.llmProvider, "openai");
  const model = config.llmModel || getDefaultModelForProvider(provider);
  const baseUrl = config.llmBaseUrl;
  return { provider, model, baseUrl };
}

/**
 * Build the code-search context: index workspace, parse story, and resolve imports.
 */
async function collectContextForIssue(params: {
  config: WorkflowConfig;
  storyText: string;
  log: (step: string, msg: string) => void;
}): Promise<{
  parsedStory: ReturnType<typeof parseStory>;
  searchResults: SearchResult;
  imports: string[];
  outputDir: string;
  testDir: string;
}> {
  const { config, storyText, log } = params;

  log("index", "Indexing codebase");
  const codebaseIndex = await indexCodebase(config.workspaceRoot);

  log("parse", "Parsing story entities");
  const parsedStory = parseStory(storyText);
  log("parse", `entities: ${parsedStory.entities.join(", ")}`);

  log("search", "Searching for matching components");
  const searchResults = searchComponents(codebaseIndex, parsedStory.entities);
  log(
    "search",
    `Matched ${searchResults.matchedInterfaces.length} interfaces, ${searchResults.matchedClasses.length} classes`,
  );

  const outputDir = normalizeOutputDir(config.testOutputDir);
  const testDir = path.join(config.workspaceRoot, outputDir);
  const imports = searchResults.matchedInterfaces
    .filter((iface) => iface.isExported)
    .map((iface) => resolveImport(iface, testDir));

  return { parsedStory, searchResults, imports, outputDir, testDir };
}

/**
 * Post a comment and short-circuit the workflow when no components match the story.
 */
async function handleNoMatches(
  issue: GitHubIssue,
  client: GitHubClient,
  parsedStory: ReturnType<typeof parseStory>,
  log: (step: string, msg: string) => void,
): Promise<WorkflowResult> {
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

/**
 * Generate tests (with validation when possible) and return the validation outcome.
 */
async function generateAndValidate(params: {
  issue: GitHubIssue;
  config: WorkflowConfig;
  storyText: string;
  frameworkInfo: { framework: TestFramework; shouldValidate: boolean };
  llmConfig: { provider: LLMProvider; model: string; baseUrl?: string };
  context: {
    parsedStory: ReturnType<typeof parseStory>;
    searchResults: SearchResult;
    imports: string[];
    outputDir: string;
    testDir: string;
  };
  log: (step: string, msg: string) => void;
}): Promise<WorkflowValidationResult> {
  const { config, storyText, frameworkInfo, llmConfig, context, log } = params;
  const { framework, shouldValidate } = frameworkInfo;

  log("generate", "Generating and validating tests");
  const missingDeps = shouldValidate
    ? detectMissingValidationDeps(config.workspaceRoot, framework)
    : [];

  if (shouldValidate && missingDeps.length === 0) {
    return {
      ...(await validateAndFixTest({
        apiKey: config.llmApiKey,
        model: llmConfig.model,
        provider: llmConfig.provider,
        baseUrl: llmConfig.baseUrl,
        userStory: storyText,
        searchResults: context.searchResults,
        testDir: context.testDir,
        framework,
        imports: context.imports,
        workspacePath: config.workspaceRoot,
        maxAttempts: config.maxAttempts ?? 3,
      })),
      skipped: false,
      framework,
    };
  }

  if (missingDeps.length > 0) {
    log("validate", `Skipping — missing deps: ${missingDeps.join(", ")}`);
  }

  const generated = await generateWithoutValidation({
    apiKey: config.llmApiKey,
    model: llmConfig.model,
    provider: llmConfig.provider,
    baseUrl: llmConfig.baseUrl,
    userStory: storyText,
    searchResults: context.searchResults,
    testDir: context.testDir,
    framework,
    imports: context.imports,
  });

  return missingDeps.length > 0
    ? { ...generated, lastError: `Missing validation deps: ${missingDeps.join(", ")}` }
    : generated;
}

/**
 * Create or update a PR containing the generated test file.
 */
async function upsertPullRequest(params: {
  issue: GitHubIssue;
  config: WorkflowConfig;
  client: GitHubClient;
  validationResult: WorkflowValidationResult;
  searchResults: SearchResult;
  log: (step: string, msg: string) => void;
}): Promise<{ prUrl: string | null; prHeadSha?: string; prNumber?: number }> {
  const { issue, config, client, validationResult, searchResults, log } = params;

  let branchName = `test/issue-${issue.number}`;
  const testFilePath = path.posix.join(normalizeOutputDir(config.testOutputDir), validationResult.fileName);

  const prTitle = `Tests for issue #${issue.number}: ${issue.title}`;
  const prBody = buildPRBody(issue, validationResult, searchResults);

  const existingPr: ExistingPRInfo | null = await client.findExistingPR({ issueNumber: issue.number });
  let prUrl: string | null = existingPr?.url || null;
  let prHeadSha: string | undefined = existingPr?.headSha;
  let prNumber: number | undefined = existingPr?.number;
  if (existingPr?.headRef) {
    branchName = existingPr.headRef;
  }

  if (prUrl) {
    log("pr", `Updating existing PR: ${prUrl}`);
    await ensureBranchExists({ branchName, client, baseBranch: config.baseBranch, log });
    await client.commitFile(
      branchName,
      testFilePath,
      validationResult.code,
      `Update generated tests for issue #${issue.number}`,
    );
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

  return { prUrl, prHeadSha, prNumber };
}

/**
 * Ensure a working branch exists; create from base when absent.
 */
async function ensureBranchExists(params: {
  branchName: string;
  client: GitHubClient;
  baseBranch?: string;
  log: (step: string, msg: string) => void;
}): Promise<void> {
  const { branchName, client, baseBranch, log } = params;
  const branchExists = await client.findBranch(branchName);
  if (branchExists) return;

  const base = baseBranch || "main";
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

  log("branch", `Creating branch ${branchName} from ${base}`);
  await client.createBranch(branchName, baseSHA);
}

/**
 * Optionally add a label to the PR when a number is present.
 */
async function maybeLabelPullRequest(params: {
  client: GitHubClient;
  prNumber?: number;
  log: (step: string, msg: string) => void;
}): Promise<void> {
  const { client, prNumber, log } = params;
  if (!prNumber) return;

  try {
    log("label", "Adding 'tests-generated' label");
    await client.addLabel({ prNumber, label: "tests-generated" });
  } catch (labelErr: any) {
    log("label", `Failed: ${labelErr?.message}`);
  }
}

/**
 * Optionally create a GitHub Check Run when validation passes and checks are enabled.
 */
async function maybeCreateCheckRun(params: {
  client: GitHubClient;
  validationResult: WorkflowValidationResult;
  prHeadSha?: string;
  log: (step: string, msg: string) => void;
}): Promise<void> {
  const { client, validationResult, prHeadSha, log } = params;
  const useCheckRuns = envBool("USE_CHECK_RUNS");

  if (!useCheckRuns) {
    log("check", "Skipping check run (PAT or checks disabled)");
    return;
  }

  if (!prHeadSha || !validationResult.passed) {
    log("check", "Skipping (validation did not pass)");
    return;
  }

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
}

/**
 * Post a summary comment on the originating issue with validation and PR info.
 */
async function commentOnIssueWithResults(params: {
  client: GitHubClient;
  issue: GitHubIssue;
  prUrl: string | null;
  validationResult: WorkflowValidationResult;
  searchResults: SearchResult;
  log: (step: string, msg: string) => void;
}): Promise<void> {
  const { client, issue, prUrl, validationResult, searchResults, log } = params;
  log("comment", "Posting results to issue");
  const issueComment = buildIssueComment(prUrl || "", validationResult, searchResults);
  await client.commentOnIssue(issue.number, issueComment);
}

function buildPRBody(
  issue: GitHubIssue,
  validationResult: WorkflowValidationResult,
  searchResults: SearchResult,
): string {
  const validationStatus = validationResult.skipped
    ? `⏭ Skipped for framework \`${validationResult.framework}\``
    : validationResult.passed
      ? `Passed after ${validationResult.attempts} attempt(s)`
      : `Did not pass after ${validationResult.attempts} attempt(s)`;

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
    ? `⏭ Skipped (${validationResult.attempts} attempt)`
    : validationResult.passed
      ? ` Passed (${validationResult.attempts} attempt(s))`
      : ` Failed (${validationResult.attempts} attempt(s))`;

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

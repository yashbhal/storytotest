import * as path from "path";
import { detectFramework, TestFramework } from "../core/frameworkDetector";
import { indexCodebase } from "../core/codebaseIndexer";
import { parseStory } from "../core/storyParser";
import { searchComponents } from "../core/componentSearch";
import { validateAndFixTest } from "../core/testValidator";
import { resolveImport } from "../core/importResolver";
import { generateTest } from "../core/testGenerator";
import {
  GitHubClient,
  ExistingPRInfo,
  CreateTestPRResult,
} from "./githubClient";

export interface WorkflowConfig {
  workspaceRoot: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  openaiApiKey: string;
  baseBranch?: string;
  maxAttempts?: number;
  testOutputDir?: string;
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

export async function processGitHubIssue(
  issue: GitHubIssue,
  config: WorkflowConfig,
): Promise<WorkflowResult> {
  const client = new GitHubClient({
    token: config.githubToken,
    owner: config.githubOwner,
    repo: config.githubRepo,
  });

  try {
    // Step 1: Extract story from issue
    console.log(`Processing issue #${issue.number}: ${issue.title}`);
    const storyText = [issue.title, issue.body ?? ""].join("\n").trim();

    // Step 2: Detect test framework
    console.log(`Detecting test framework in: ${config.workspaceRoot}`);
    const framework = detectFramework(config.workspaceRoot);
    console.log(`Detected framework: ${framework}`);
    const shouldValidate = framework === "jest" || framework === "vitest";

    // Step 3: Index codebase
    console.log(`Indexing codebase at: ${config.workspaceRoot}`);
    const codebaseIndex = await indexCodebase(config.workspaceRoot);

    // Step 4: Parse story entities
    console.log(`Parsing story entities`);
    const parsedStory = parseStory(storyText);
    console.log(`Found entities: ${parsedStory.entities.join(", ")}`);

    // Step 5: Search for matching components
    console.log(`Searching for matching components`);
    const searchResults = searchComponents(codebaseIndex, parsedStory.entities);
    console.log(
      `Matched ${searchResults.matchedInterfaces.length} interfaces and ${searchResults.matchedClasses.length} classes`,
    );

    if (
      searchResults.matchedInterfaces.length === 0 &&
      searchResults.matchedClasses.length === 0
    ) {
      const message = "No matching components found for the story; skipping PR creation.";
      console.log(message);
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

    // Step 6 and 7: Generate and validate test code (up to 3 attempts)
    const outputDir = normalizeOutputDir(config.testOutputDir);
    const testDir = path.join(config.workspaceRoot, outputDir);
    const imports = searchResults.matchedInterfaces
      .filter((iface) => iface.isExported)
      .map((iface) => resolveImport(iface, testDir));

    console.log(`Generating and validating tests`);
    const validationResult: WorkflowValidationResult = shouldValidate
      ? {
          ...(await validateAndFixTest({
            apiKey: config.openaiApiKey,
            model: "gpt-4-turbo",
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
        }
      : await generateWithoutValidation({
          apiKey: config.openaiApiKey,
          userStory: storyText,
          searchResults,
          testDir,
          framework,
          imports,
        });

    console.log(
      `Validation result: passed=${validationResult.passed}, attempts=${validationResult.attempts}`,
    );

    // Step 8: Create GitHub branch
    let branchName = `test/issue-${issue.number}`;
    const testFilePath = path.posix.join(outputDir, validationResult.fileName);

    // Steps 9 and 10: Commit file and create PR
    const prTitle = `Tests for issue #${issue.number}: ${issue.title}`;
    const prBody = buildPRBody(issue, validationResult);

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
      console.log(`Creating PR for branch: ${branchName}`);
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

    // Add PR label for visibility
    if (prNumber) {
      try {
        await client.addLabel({ prNumber, label: "tests-generated" });
      } catch (labelErr: any) {
        console.log(`Failed to add label: ${labelErr?.message}`);
      }
    }

    // Create check run with validation status
    if (prHeadSha) {
      const summary = validationResult.skipped
        ? `Validation skipped for ${validationResult.framework}`
        : validationResult.passed
          ? `Validation passed in ${validationResult.attempts} attempt(s)`
          : `Validation failed after ${validationResult.attempts} attempt(s)`;
      const details = !validationResult.skipped && validationResult.lastError
        ? formatErrorSnippet(validationResult.lastError)
        : undefined;
      try {
        await client.createCheckRun({
          name: "StoryToTest",
          headSha: prHeadSha,
          conclusion: validationResult.skipped || validationResult.passed ? "success" : "failure",
          summary,
          details,
        });
      } catch (checkErr: any) {
        console.log(`Failed to create check run: ${checkErr?.message}`);
      }
    }

    // Step 11: Comment on issue with PR link and results
    const issueComment = buildIssueComment(prUrl || "", validationResult);
    await client.commentOnIssue(issue.number, issueComment);

    console.log(`Workflow completed successfully for issue #${issue.number}`);
    return { success: true, prUrl };
  } catch (err: any) {
    const errorMessage = err?.message ?? "Unknown error";
    console.log(`Workflow failed for issue #${issue.number}: ${errorMessage}`);

    try {
      await client.commentOnIssue(
        issue.number,
        `Test generation failed: ${errorMessage}`,
      );
    } catch (commentErr: any) {
      console.log(`Failed to comment on issue: ${commentErr?.message}`);
    }

    return { success: false, error: errorMessage };
  }
}

function buildPRBody(
  issue: GitHubIssue,
  validationResult: WorkflowValidationResult,
): string {
  const validationStatus = validationResult.skipped
    ? `Skipped for framework ${validationResult.framework}`
    : validationResult.passed
      ? `Passed after ${validationResult.attempts} attempt(s)`
      : `Did not pass after ${validationResult.attempts} attempt(s) - ${validationResult.lastError ?? "unknown error"}`;

  const errorSection =
    validationResult.skipped || validationResult.passed || !validationResult.lastError
      ? ""
      : `\n\n<details><summary>Last validation error</summary>\n\n${formatErrorSnippet(validationResult.lastError)}\n\n</details>`;

  return [
    `## Auto-generated Tests`,
    ``,
    `This PR was automatically generated from issue #${issue.number}.`,
    ``,
    `**Issue:** [${issue.title}](${issue.html_url})`,
    ``,
    `**Validation:** ${validationStatus}` + errorSection,
    ``,
    `### Issue Description`,
    ``,
    issue.body ?? "_No description provided._",
  ].join("\n");
}

function buildIssueComment(
  prUrl: string,
  validationResult: WorkflowValidationResult,
): string {
  const status = validationResult.skipped
    ? `generated (validation skipped for ${validationResult.framework}) and a pull request has been created`
    : validationResult.passed
      ? "passed validation and a pull request has been created"
      : "generated (validation did not pass) and a pull request has been created";

  const errorSnippet = !validationResult.skipped && !validationResult.passed && validationResult.lastError
    ? [``, `Last error:`, formatErrorSnippet(validationResult.lastError)].join("\n")
    : "";

  return [
    `Tests have been ${status}.`,
    ``,
    `**PR:** ${prUrl}`,
    ``,
    `Validation attempts: ${validationResult.attempts}`,
    errorSnippet,
  ].join("\n");
}

function formatErrorSnippet(error: string): string {
  const trimmed = error.trim();
  const lines = trimmed.split(/\r?\n/).slice(0, 20); // cap length for readability
  return "```\n" + lines.join("\n") + "\n```";
}

async function generateWithoutValidation(params: {
  apiKey: string;
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
    "gpt-4-turbo",
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

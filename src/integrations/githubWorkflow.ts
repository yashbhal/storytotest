import * as path from "path";
import { detectFramework } from "../core/frameworkDetector";
import { indexCodebase } from "../core/codebaseIndexer";
import { parseStory } from "../core/storyParser";
import { searchComponents } from "../core/componentSearch";
import { validateAndFixTest } from "../core/testValidator";
import { resolveImport } from "../core/importResolver";
import { GitHubClient } from "./githubClient";

export interface WorkflowConfig {
  workspaceRoot: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  openaiApiKey: string;
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

    // Step 6 and 7: Generate and validate test code (up to 3 attempts)
    const testDir = path.join(config.workspaceRoot, "__tests__");
    const imports = searchResults.matchedInterfaces.map((iface) =>
      resolveImport(iface, testDir),
    );

    console.log(`Generating and validating tests`);
    const validationResult = await validateAndFixTest({
      apiKey: config.openaiApiKey,
      model: "gpt-4-turbo",
      userStory: storyText,
      searchResults,
      testDir,
      framework,
      imports,
      workspacePath: config.workspaceRoot,
      maxAttempts: 3,
    });

    console.log(
      `Validation result: passed=${validationResult.passed}, attempts=${validationResult.attempts}`,
    );

    // Step 8: Create GitHub branch
    const timestamp = Date.now();
    const branchName = `test/issue-${issue.number}-${timestamp}`;
    const testFilePath = `__tests__/${validationResult.fileName}`;

    // Steps 9 and 10: Commit file and create PR
    const prTitle = `Tests for issue #${issue.number}: ${issue.title}`;
    const prBody = buildPRBody(issue, validationResult);

    console.log(`Creating PR for branch: ${branchName}`);
    const prUrl = await client.createTestPR({
      issueNumber: issue.number,
      branchName,
      filePath: testFilePath,
      fileContent: validationResult.code,
      prTitle,
      prBody,
    });

    // Step 11: Comment on issue with PR link and results
    const issueComment = buildIssueComment(prUrl, validationResult);
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
  validationResult: { passed: boolean; attempts: number; lastError: string | null },
): string {
  const validationStatus = validationResult.passed
    ? `Passed after ${validationResult.attempts} attempt(s)`
    : `Did not pass after ${validationResult.attempts} attempt(s) - ${validationResult.lastError ?? "unknown error"}`;

  return [
    `## Auto-generated Tests`,
    ``,
    `This PR was automatically generated from issue #${issue.number}.`,
    ``,
    `**Issue:** [${issue.title}](${issue.html_url})`,
    ``,
    `**Validation:** ${validationStatus}`,
    ``,
    `### Issue Description`,
    ``,
    issue.body ?? "_No description provided._",
  ].join("\n");
}

function buildIssueComment(
  prUrl: string,
  validationResult: { passed: boolean; attempts: number },
): string {
  const status = validationResult.passed
    ? "passed validation and a pull request has been created"
    : "generated (validation did not pass) and a pull request has been created";

  return [
    `Tests have been ${status}.`,
    ``,
    `**PR:** ${prUrl}`,
    ``,
    `Validation attempts: ${validationResult.attempts}`,
  ].join("\n");
}

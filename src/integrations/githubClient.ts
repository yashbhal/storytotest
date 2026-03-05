import { Octokit } from "@octokit/rest";

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  dryRun?: boolean;
}

interface CreateTestPROptions {
  issueNumber: number;
  branchName: string;
  filePath: string;
  fileContent: string;
  prTitle: string;
  prBody: string;
  baseBranch?: string;
}

export interface CreateTestPRResult {
  url: string;
  headRef: string;
  headSha: string;
  number: number;
}

interface ExistingPROptions {
  issueNumber: number;
}

export interface ExistingPRInfo {
  url: string;
  headRef: string;
  headSha: string;
  number: number;
}

interface CheckRunOptions {
  name: string;
  headSha: string;
  conclusion: "success" | "failure";
  summary: string;
  details?: string;
}

interface LabelOptions {
  prNumber: number;
  label: string;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private dryRun: boolean;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
    this.dryRun = config.dryRun ?? false;
  }

  async findBranch(branchName: string): Promise<boolean> {
    try {
      await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: branchName,
      });
      return true;
    } catch (err: any) {
      if (err?.status === 404) return false;
      throw err;
    }
  }

  async getDefaultBranchSHA(branch: string): Promise<string> {
    console.log(`Getting SHA for branch: ${branch}`);
    const response = await this.octokit.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch,
    });
    return response.data.commit.sha;
  }

  async getBranchHeadSHA(branch: string): Promise<string> {
    const response = await this.octokit.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch,
    });
    return response.data.commit.sha;
  }

  async createBranch(branchName: string, fromSHA: string): Promise<void> {
    if (this.dryRun) {
      console.log(`[dry-run][branch] Would create branch: ${branchName} from SHA: ${fromSHA}`);
      return;
    }
    console.log(`Creating branch: ${branchName} from SHA: ${fromSHA}`);
    try {
      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: fromSHA,
      });
      console.log(`Branch created: ${branchName}`);
    } catch (err: any) {
      if (err?.status === 422) {
        console.log(`Branch already exists: ${branchName}`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Creates or updates a file on a branch with the provided content and message.
   */
  async commitFile(
    branchName: string,
    filePath: string,
    content: string,
    message: string,
  ): Promise<void> {
    if (this.dryRun) {
      console.log(`[dry-run][commit] Would commit file: ${filePath} to branch: ${branchName}`);
      console.log(`[dry-run][commit] Message: ${message}`);
      console.log(`[dry-run][commit] Content length: ${content.length} bytes`);
      return;
    }
    console.log(`Committing file: ${filePath} to branch: ${branchName}`);
    const base64Content = Buffer.from(content, "utf-8").toString("base64");
    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      message,
      content: base64Content,
      branch: branchName,
    });
    console.log(`File committed: ${filePath}`);
  }

  /**
   * Creates a pull request from head -> base and returns basic PR metadata.
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<CreateTestPRResult> {
    if (this.dryRun) {
      console.log(`[dry-run][pr] Would create PR: ${title}`);
      console.log(`[dry-run][pr] Head: ${head}, Base: ${base}`);
      console.log(`[dry-run][pr] Body preview: ${body.substring(0, 200)}...`);
      return {
        url: `https://github.com/${this.owner}/${this.repo}/pull/0`,
        headRef: head,
        headSha: "dry-run-sha",
        number: 0,
      };
    }
    console.log(`Creating PR: ${title}`);
    const response = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head,
      base,
    });
    console.log(`PR created: ${response.data.html_url}`);
    return {
      url: response.data.html_url,
      headRef: response.data.head.ref,
      headSha: response.data.head.sha,
      number: response.data.number,
    };
  }

  /**
   * Posts a comment on the given issue number.
   */
  async commentOnIssue(issueNumber: number, comment: string): Promise<void> {
    if (this.dryRun) {
      console.log(`[dry-run][comment] Would comment on issue #${issueNumber}`);
      console.log(`[dry-run][comment] Content preview: ${comment.substring(0, 200)}...`);
      return;
    }
    console.log(`Commenting on issue #${issueNumber}`);
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: comment,
    });
    console.log(`Comment added to issue #${issueNumber}`);
  }

  /**
   * Finds an open PR whose title contains the issue number (e.g., "#123").
   */
  async findExistingPR(options: ExistingPROptions): Promise<ExistingPRInfo | null> {
    const { issueNumber } = options;
    const { data } = await this.octokit.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: "open",
      per_page: 50,
    });

    const match = data.find((pr) => {
      const title = pr.title || "";
      return title.includes(`#${issueNumber}`);
    });

    if (!match) return null;

    return {
      url: match.html_url,
      headRef: match.head.ref,
      headSha: match.head.sha,
      number: match.number,
    };
  }

  /**
   * Creates or reuses a branch, commits the test file, and opens a PR.
   */
  async createTestPR(options: CreateTestPROptions): Promise<CreateTestPRResult> {
    console.log(`Starting test PR creation for issue #${options.issueNumber}`);

    const requestedBaseBranch = options.baseBranch || "main";
    let baseBranch = requestedBaseBranch;
    let baseSHA: string;

    try {
      baseSHA = await this.getDefaultBranchSHA(baseBranch);
    } catch (err: any) {
      if (err?.status === 404 && requestedBaseBranch === "main") {
        console.log(`Branch 'main' not found, trying 'master'`);
        baseSHA = await this.getDefaultBranchSHA("master");
        baseBranch = "master";
      } else {
        throw err;
      }
    }

    const branchExists = await this.findBranch(options.branchName);
    if (!branchExists) {
      await this.createBranch(options.branchName, baseSHA);
    } else {
      console.log(`Reusing existing branch: ${options.branchName}`);
    }
    await this.commitFile(
      options.branchName,
      options.filePath,
      options.fileContent,
      `Add generated tests for issue #${options.issueNumber}`,
    );

    const pr = await this.createPullRequest(
      options.prTitle,
      options.prBody,
      options.branchName,
      baseBranch,
    );

    return pr;
  }

  /**
   * Fetches PR metadata (URL, head ref/SHA, number) for an existing PR.
   */
  async getPullRequest(prNumber: number): Promise<CreateTestPRResult> {
    const pr = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    return {
      url: pr.data.html_url,
      headRef: pr.data.head.ref,
      headSha: pr.data.head.sha,
      number: pr.data.number,
    };
  }

  /**
   * Creates a GitHub Check Run on the given head SHA.
   */
  async createCheckRun(options: CheckRunOptions): Promise<void> {
    if (this.dryRun) {
      console.log(`[dry-run][check] Would create check run: ${options.name}`);
      console.log(`[dry-run][check] Conclusion: ${options.conclusion}, Summary: ${options.summary}`);
      return;
    }
    await this.octokit.checks.create({
      owner: this.owner,
      repo: this.repo,
      name: options.name,
      head_sha: options.headSha,
      conclusion: options.conclusion,
      output: {
        title: options.summary,
        summary: options.summary,
        text: options.details,
      },
    });
  }

  /**
   * Adds a label to a pull request (issues.addLabels on the PR number).
   */
  async addLabel(options: LabelOptions): Promise<void> {
    if (this.dryRun) {
      console.log(`[dry-run][label] Would add label "${options.label}" to PR #${options.prNumber}`);
      return;
    }
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: options.prNumber,
      labels: [options.label],
    });
  }
}

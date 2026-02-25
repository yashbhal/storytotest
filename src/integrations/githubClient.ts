import { Octokit } from "@octokit/rest";

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
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

interface ExistingPROptions {
  issueNumber: number;
}

export interface ExistingPRInfo {
  url: string;
  headRef: string;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
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

  async createBranch(branchName: string, fromSHA: string): Promise<void> {
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

  async commitFile(
    branchName: string,
    filePath: string,
    content: string,
    message: string,
  ): Promise<void> {
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

  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<string> {
    console.log(`Creating PR: ${title}`);
    const response = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head,
      base,
    });
    const prUrl = response.data.html_url;
    console.log(`PR created: ${prUrl}`);
    return prUrl;
  }

  async commentOnIssue(issueNumber: number, comment: string): Promise<void> {
    console.log(`Commenting on issue #${issueNumber}`);
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: comment,
    });
    console.log(`Comment added to issue #${issueNumber}`);
  }

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
    };
  }

  async createTestPR(options: CreateTestPROptions): Promise<string> {
    console.log(`Starting test PR creation for issue #${options.issueNumber}`);

    let baseBranch = options.baseBranch || "main";
    let baseSHA: string;

    try {
      baseSHA = await this.getDefaultBranchSHA("main");
    } catch (err: any) {
      if (err?.status === 404) {
        console.log(`Branch 'main' not found, trying 'master'`);
        baseSHA = await this.getDefaultBranchSHA("master");
        baseBranch = "master";
      } else if (options.baseBranch) {
        // If a custom baseBranch was provided but fetch failed with non-404, surface error.
        throw err;
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

    const prUrl = await this.createPullRequest(
      options.prTitle,
      options.prBody,
      options.branchName,
      baseBranch,
    );

    return prUrl;
  }
}

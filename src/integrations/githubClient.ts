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

  async getBranchHeadSHA(branch: string): Promise<string> {
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
  ): Promise<CreateTestPRResult> {
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
      headSha: match.head.sha,
      number: match.number,
    };
  }

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

  async createCheckRun(options: CheckRunOptions): Promise<void> {
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

  async addLabel(options: LabelOptions): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: options.prNumber,
      labels: [options.label],
    });
  }
}

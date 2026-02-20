import { IncomingMessage, ServerResponse } from "http";
import { processGitHubIssue, WorkflowConfig } from "../../src/integrations/githubWorkflow";

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Method not allowed" }));
    return;
  }

  const payload = (req as any).body ?? (await readBody(req));
  const { action, label, issue } = payload;

  if (!issue) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "No issue in payload" }));
    return;
  }

  if (action !== "labeled" || label?.name !== "ready-for-tests") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Event ignored" }));
    return;
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const githubOwner = process.env.GITHUB_OWNER;
  const githubRepo = process.env.GITHUB_REPO;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? "/tmp/workspace";

  if (!githubToken || !githubOwner || !githubRepo || !openaiApiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Missing required environment variables" }));
    return;
  }

  // Respond immediately - do not make GitHub wait for processing
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Accepted" }));

  const config: WorkflowConfig = {
    workspaceRoot,
    githubToken,
    githubOwner,
    githubRepo,
    openaiApiKey,
  };

  const githubIssue = {
    number: issue.number as number,
    title: issue.title as string,
    body: issue.body as string | null,
    html_url: issue.html_url as string,
  };

  processGitHubIssue(githubIssue, config).catch((err: any) => {
    console.log(`Unhandled error in processGitHubIssue: ${err?.message}`);
  });
}

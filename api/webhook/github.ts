import * as crypto from "crypto";
import { IncomingMessage, ServerResponse } from "http";
import { processGitHubIssue, WorkflowConfig } from "../../src/integrations/githubWorkflow";
import { resolveLLMEnvConfig } from "../../src/llm/env";
import { envBool, envString } from "../../src/integrations/envHelper";
import { WaitUntilFn, readRawBody, parseJson, ensureWorkspace, resolveWaitUntil } from "./webhookUtils";

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf-8");
  const bBuffer = Buffer.from(b, "utf-8");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function verifySignature(
  secret: string | undefined,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!secret) {
    return true;
  }
  if (!signature) {
    return false;
  }

  const expectedSignature =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  return safeEqual(expectedSignature, signature);
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

  const rawBody = await readRawBody(req);
  const payload = (req as any).body ?? parseJson(rawBody);
  const signatureHeader = req.headers["x-hub-signature-256"];
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  const webhookSecret = envString("GITHUB_WEBHOOK_SECRET") || envString("WEBHOOK_SECRET");

  if (webhookSecret) {
    if (!verifySignature(webhookSecret, rawBody, signature)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid webhook signature" }));
      return;
    }
  } else {
    console.log("[webhook] GITHUB_WEBHOOK_SECRET/WEBHOOK_SECRET not set; skipping signature verification");
  }

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

  const githubToken = envString("GITHUB_TOKEN");
  const githubOwner = envString("GITHUB_OWNER");
  const githubRepo = envString("GITHUB_REPO");
  const llm = resolveLLMEnvConfig(process.env);
  const workspaceRoot = envString("WORKSPACE_ROOT", "/tmp/workspace");
  const dryRun = envBool("DRY_RUN");

  if (!githubToken || !githubOwner || !githubRepo || !llm.apiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Missing required environment variables" }));
    return;
  }

  // Ensure workspace exists for serverless environments
  try {
    ensureWorkspace(workspaceRoot, githubOwner, githubRepo, githubToken, issue.number as number);
  } catch (wsErr: any) {
    console.log(`[issue #${issue.number}][workspace] ${wsErr.message}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: wsErr.message }));
    return;
  }

  const config: WorkflowConfig = {
    workspaceRoot,
    githubToken,
    githubOwner,
    githubRepo,
    llmApiKey: llm.apiKey,
    llmProvider: llm.provider,
    llmModel: llm.model,
    llmBaseUrl: llm.baseUrl,
    dryRun,
  };

  const githubIssue = {
    number: issue.number as number,
    title: issue.title as string,
    body: issue.body as string | null,
    html_url: issue.html_url as string,
  };

  const task = processGitHubIssue(githubIssue, config);
  const waitUntil = resolveWaitUntil();

  if (waitUntil) {
    waitUntil(
      task.catch((err: any) => {
        console.log(`Unhandled error in processGitHubIssue: ${err?.message}`);
      }),
    );
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Accepted" }));
    return;
  }

  try {
    const result = await task;
    res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err: any) {
    console.log(`Unhandled error in processGitHubIssue: ${err?.message}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Processing failed" }));
  }
}

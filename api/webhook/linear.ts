import * as crypto from "crypto";
import { IncomingMessage, ServerResponse } from "http";
import { processGitHubIssue, WorkflowConfig } from "../../src/integrations/githubWorkflow";
import { resolveLLMEnvConfig } from "../../src/llm/env";
import { envBool, envString } from "../../src/integrations/envHelper";
import { WaitUntilFn, readRawBody, parseJson, ensureWorkspace, resolveWaitUntil } from "./webhookUtils";

// Linear sends a raw hex HMAC-SHA256 digest (no "sha256=" prefix).
function verifyLinearSignature(
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

  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest();

  const headerSignature = Buffer.from(signature, "hex");

  if (computedSignature.length !== headerSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedSignature, headerSignature);
}

// Parse the numeric part of a Linear identifier, e.g. "ENG-42" -> 42.
function parseIdentifierNumber(identifier: string | undefined): number {
  if (!identifier) {
    return 0;
  }
  const parts = identifier.split("-");
  const numeric = parseInt(parts[parts.length - 1], 10);
  return Number.isNaN(numeric) ? 0 : numeric;
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
  const signatureHeader = req.headers["linear-signature"];
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  const webhookSecret = envString("LINEAR_WEBHOOK_SECRET");

  if (webhookSecret) {
    if (!verifyLinearSignature(webhookSecret, rawBody, signature)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid webhook signature" }));
      return;
    }
  } else {
    console.log("[webhook] LINEAR_WEBHOOK_SECRET not set; skipping signature verification");
  }

  const { action, type, data, updatedFrom } = payload;

  if (!data) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "No data in payload" }));
    return;
  }

  const triggerState = envString("LINEAR_TRIGGER_STATE", "Done");

  // Only act on Issue update events where the state specifically changed to the trigger state.
  // updatedFrom.stateId being present confirms the state field was the one updated.
  if (
    action !== "update" ||
    type !== "Issue" ||
    data?.state?.name !== triggerState ||
    updatedFrom?.stateId === undefined
  ) {
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

  const issueNumber = parseIdentifierNumber(data.identifier as string | undefined);

  // Ensure workspace exists for serverless environments
  try {
    ensureWorkspace(workspaceRoot, githubOwner, githubRepo, githubToken, issueNumber);
  } catch (wsErr: any) {
    console.log(`[issue #${issueNumber}][workspace] ${wsErr.message}`);
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
    number: issueNumber,
    title: data.title as string,
    body: (data.description as string | null | undefined) ?? null,
    html_url: (data.url as string | undefined) || (payload.url as string),
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

import * as http from "http";
import * as crypto from "crypto";
import { processGitHubIssue, WorkflowConfig, GitHubIssue } from "./githubWorkflow";
import { resolveLLMEnvConfig } from "../llm/env";
import { envBool, envInt, envString } from "./envHelper";

interface WebhookServerConfig extends WorkflowConfig {
  port: number;
  webhookSecret?: string;
  triggerLabel?: string;
}

function verifySignature(secret: string | undefined, body: string, signature: string | undefined): boolean {
  if (!secret) return true; // allow when no secret configured
  if (!signature) return false;
  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(body).digest("hex");
  // Use constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function parseIssuePayload(payload: any): GitHubIssue | null {
  if (!payload?.issue) return null;
  const issue = payload.issue;
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    html_url: issue.html_url,
  };
}

function allowedAction(action: string | undefined): boolean {
  // Default: only run on issue closed (so code is expected to exist)
  return action === "closed";
}

export function startIssueWebhookServer(config: WebhookServerConfig): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }

      const event = req.headers["x-github-event"] as string | undefined;
      if (event !== "issues") {
        res.writeHead(202);
        res.end("ignored");
        return;
      }

      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      const body = await new Promise<string>((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => resolve(raw));
        req.on("error", reject);
      });

      if (!verifySignature(config.webhookSecret, body, signature)) {
        res.writeHead(401);
        res.end("invalid signature");
        return;
      }

      const payload = JSON.parse(body || "{}");
      if (!allowedAction(payload.action)) {
        res.writeHead(202);
        res.end("ignored action");
        return;
      }

      const issue = parseIssuePayload(payload);
      if (!issue) {
        res.writeHead(400);
        res.end("no issue in payload");
        return;
      }

      if (config.triggerLabel) {
        const labels = (payload.issue?.labels ?? []).map((l: any) => l.name).filter(Boolean);
        if (!labels.includes(config.triggerLabel)) {
          res.writeHead(202);
          res.end("label gate not met");
          return;
        }
      }

      console.log(`Received issue event #${issue.number} (${payload.action})`);
      const result = await processGitHubIssue(issue, config);
      res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      console.error("Webhook error", err);
      res.writeHead(500);
      res.end("error");
    }
  });

  server.listen(config.port, () => {
    console.log(`StoryToTest GitHub webhook listening on :${config.port}`);
  });

  return server;
}

function getEnvConfig(): WebhookServerConfig | null {
  const workspaceRoot = envString("WORKSPACE_ROOT");
  const githubToken = envString("GITHUB_TOKEN");
  const githubOwner = envString("GITHUB_OWNER");
  const githubRepo = envString("GITHUB_REPO");
  const llm = resolveLLMEnvConfig(process.env);

  if (!workspaceRoot || !githubToken || !githubOwner || !githubRepo || !llm.apiKey) {
    console.error(
      "Missing required env vars: WORKSPACE_ROOT, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, and a provider API key (LLM_API_KEY or provider-specific key)",
    );
    return null;
  }

  return {
    workspaceRoot,
    githubToken,
    githubOwner,
    githubRepo,
    llmApiKey: llm.apiKey,
    llmProvider: llm.provider,
    llmModel: llm.model,
    llmBaseUrl: llm.baseUrl,
    baseBranch: envString("BASE_BRANCH"),
    maxAttempts: envInt("MAX_ATTEMPTS"),
    testOutputDir: envString("TEST_OUTPUT_DIR"),
    webhookSecret: envString("WEBHOOK_SECRET"),
    triggerLabel: envString("TRIGGER_LABEL"),
    dryRun: envBool("DRY_RUN"),
    port: envInt("PORT", 3000) as number,
  };
}

// Allow running as a small webhook server via `ts-node src/integrations/githubWebhook.ts`
if (require.main === module) {
  const envConfig = getEnvConfig();
  if (!envConfig) {
    process.exit(1);
  }
  startIssueWebhookServer(envConfig);
}

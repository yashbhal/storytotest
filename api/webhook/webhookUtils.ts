import { execSync } from "child_process";
import * as fs from "fs";
import { IncomingMessage } from "http";

export type WaitUntilFn = (promise: Promise<unknown>) => void;

export async function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer | string) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function parseJson(rawBody: string): any {
  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

export function ensureWorkspace(
  workspacePath: string,
  owner: string,
  repo: string,
  token: string,
  issueNumber: number,
): void {
  const log = (msg: string) =>
    console.log(`[issue #${issueNumber}][workspace] ${msg}`);

  // If the directory exists and has contents, assume it's already set up
  if (fs.existsSync(workspacePath)) {
    const entries = fs.readdirSync(workspacePath);
    if (entries.length > 0) {
      log(`Already populated: ${workspacePath}`);
      return;
    }
  } else {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  log(`Cloning ${owner}/${repo} into ${workspacePath} (shallow)`);
  try {
    execSync(
      `git clone --depth 1 ${cloneUrl} ${workspacePath}`,
      { stdio: "pipe", timeout: 120_000 },
    );
    log("Clone complete");
  } catch (err: any) {
    const stderr = err?.stderr?.toString().trim() ?? err?.message ?? "unknown error";
    throw new Error(`Failed to clone workspace repo: ${stderr}`);
  }
}

export function resolveWaitUntil(): WaitUntilFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vercelFunctions = require("@vercel/functions") as { waitUntil?: WaitUntilFn };
    if (typeof vercelFunctions.waitUntil === "function") {
      return vercelFunctions.waitUntil;
    }
  } catch {
    // Fallback path: run inline when helper is unavailable.
  }
  return null;
}

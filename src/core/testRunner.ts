import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { TestFramework } from "./frameworkDetector";
import { TestResult } from "./types";

export { TestResult };

const execAsync = promisify(exec);

export async function runTest(
  testFilePath: string,
  framework: TestFramework,
  workspacePath: string,
): Promise<TestResult> {
  const cwd = workspacePath || path.dirname(testFilePath);
  let command: string;

  switch (framework) {
    case "vitest":
      command = `npx vitest run ${testFilePath}`;
      break;
    case "jest":
      command = `npm test -- ${testFilePath}`;
      break;
    default:
      return { passed: false, error: "Unsupported or unknown test framework." };
  }

  try {
    const { stderr } = await execAsync(command, { cwd, maxBuffer: 1024 * 1024 });
    if (stderr && stderr.trim().length > 0) {
      // Some runners may write warnings to stderr even on pass; treat non-zero exit as failure below.
      // Keep stderr for context if exit code succeeded.
    }
    return { passed: true, error: null };
  } catch (err: any) {
    const errorOutput = err?.stderr || err?.stdout || err?.message || "Unknown error";
    return { passed: false, error: errorOutput.trim() };
  }
}

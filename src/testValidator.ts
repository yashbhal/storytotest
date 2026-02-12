import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateTest } from "./testGenerator";
import { runTest } from "./testRunner";
import { InterfaceInfo, ClassInfo } from "./codebaseIndexer";
import { TestFramework } from "./frameworkDetector";
import { SearchResult } from "./componentSearch";

export interface ValidationResult {
  code: string;
  fileName: string;
  attempts: number;
  passed: boolean;
  lastError: string | null;
}

interface ValidateParams {
  apiKey: string;
  model: string;
  userStory: string;
  searchResults: SearchResult;
  testDir: string;
  framework: TestFramework;
  imports: string[];
  workspacePath: string;
  baseExtra?: string;
  maxAttempts?: number;
  progress?: { report: (info: { message?: string }) => void };
}

export async function validateAndFixTest(params: ValidateParams): Promise<ValidationResult> {
  const {
    apiKey,
    model,
    userStory,
    searchResults,
    testDir,
    framework,
    imports,
    workspacePath,
    baseExtra = "",
    maxAttempts = 3,
    progress,
  } = params;

  let attempt = 0;
  let lastError: string | null = null;
  let bestCode = "";
  let bestFileName = "generated.test.ts";

  while (attempt < maxAttempts) {
    attempt += 1;
    const fixingSuffix = lastError ? " (fixing errors...)" : "";
    progress?.report({ message: `Attempt ${attempt}/${maxAttempts}${fixingSuffix}` });

    const extra = lastError
      ? `Previous attempt failed: ${lastError}. Fix these errors. ${baseExtra}`
      : baseExtra;

    const generated = await generateTest(
      apiKey,
      userStory,
      searchResults.matchedInterfaces as InterfaceInfo[],
      searchResults.matchedClasses as ClassInfo[],
      testDir,
      framework,
      imports,
      extra,
      model,
    );

    bestCode = generated.code;
    bestFileName = generated.fileName;

    // Write to a temp file
    const tempFilePath = path.join(
      os.tmpdir(),
      `storytotest-attempt-${Date.now()}-${Math.random().toString(16).slice(2)}.test.ts`,
    );
    fs.writeFileSync(tempFilePath, generated.code, "utf-8");

    const result = await runTest(tempFilePath, framework, workspacePath);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFilePath);
    } catch {
      // ignore cleanup errors
    }

    if (result.passed) {
      return {
        code: generated.code,
        fileName: generated.fileName,
        attempts: attempt,
        passed: true,
        lastError: null,
      };
    }

    lastError = result.error;
  }

  return {
    code: bestCode,
    fileName: bestFileName,
    attempts: attempt,
    passed: false,
    lastError,
  };
}

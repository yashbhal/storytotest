import * as fs from "fs";
import * as path from "path";
import { generateTest } from "./testGenerator";
import { runTest } from "./testRunner";
import { InterfaceInfo, ClassInfo, ValidationResult, SearchResult } from "./types";
import { TestFramework } from "./frameworkDetector";

export { ValidationResult };

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

  // Ensure target test directory exists so validation writes files with correct relative imports.
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  while (attempt < maxAttempts) {
    attempt += 1;
    const fixingSuffix = lastError ? " (fixing errors...)" : "";
    progress?.report({ message: `Attempt ${attempt}/${maxAttempts}${fixingSuffix}` });

    const extra = lastError
      ? `Previous attempt failed: ${lastError}. Fix these errors. ${baseExtra}`
      : baseExtra;

    console.log(`Validation attempt ${attempt}/${maxAttempts}`);
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

    // Write to a temp file inside testDir so relative imports remain correct during validation
    const tempFilePath = path.join(
      testDir,
      `storytotest-attempt-${attempt}-${Date.now()}-${Math.random().toString(16).slice(2)}.test.tsx`,
    );
    fs.writeFileSync(tempFilePath, generated.code, "utf-8");
    console.log(`Wrote validation file: ${tempFilePath}`);

    const result = await runTest(tempFilePath, framework, workspacePath);
    console.log(`Validation result (attempt ${attempt}): passed=${result.passed}`);
    if (result.error) {
      console.log(`Validation error output (attempt ${attempt}):\n${result.error}`);
    }

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
    console.log(`Validation attempt ${attempt} failed.`);
  }

  return {
    code: bestCode,
    fileName: bestFileName,
    attempts: attempt,
    passed: false,
    lastError,
  };
}

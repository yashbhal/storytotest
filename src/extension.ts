import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { indexCodebase } from "./codebaseIndexer";
import { parseStory } from "./storyParser";
import { searchComponents } from "./componentSearch";
import { SearchResult } from "./componentSearch";
import { generateTest } from "./testGenerator";
import { detectFramework, TestFramework } from "./frameworkDetector";
import { resolveImport } from "./importResolver";
import { validateAndFixTest } from "./testValidator";

function getWorkspacePath(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage("No workspace folder open");
    return null;
  }
  return workspaceFolders[0].uri.fsPath;
}

async function scaffoldVitest(workspacePath: string): Promise<void> {
  const vitestConfigPath = path.join(workspacePath, "vitest.config.ts");
  const setupDir = path.join(workspacePath, "test");
  const setupFilePath = path.join(setupDir, "setupTests.ts");

  if (!fs.existsSync(vitestConfigPath)) {
    const configContent = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setupTests.ts'],
  },
});
`;
    fs.writeFileSync(vitestConfigPath, configContent, "utf-8");
  }

  if (!fs.existsSync(setupDir)) {
    fs.mkdirSync(setupDir, { recursive: true });
  }

  if (!fs.existsSync(setupFilePath)) {
    const setupContent = `import '@testing-library/jest-dom';
`;
    fs.writeFileSync(setupFilePath, setupContent, "utf-8");
  }
}

async function resolveFrameworkOrPrompt(
  framework: TestFramework,
  workspacePath: string,
): Promise<{ framework: TestFramework; skipValidation: boolean; cancelled: boolean }> {
  if (framework !== "unknown") {
    return { framework, skipValidation: false, cancelled: false };
  }

  const choice = await vscode.window.showInformationMessage(
    "No Jest or Vitest detected. Set up Vitest now or skip validation?",
    { modal: false },
    "Set up Vitest",
    "Skip validation",
    "Cancel",
  );

  if (choice === "Set up Vitest") {
    await scaffoldVitest(workspacePath);
    vscode.window.showInformationMessage(
      "Created vitest.config.ts and test/setupTests.ts. Install dev deps: npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom",
    );
    return { framework: "vitest", skipValidation: false, cancelled: false };
  }

  if (choice === "Skip validation") {
    return { framework: "unknown", skipValidation: true, cancelled: false };
  }

  return { framework, skipValidation: false, cancelled: true };
}

async function validateTypeScriptWorkspace(workspacePath: string): Promise<boolean> {
  const hasTsConfig = fs.existsSync(path.join(workspacePath, "tsconfig.json"));
  const tsFiles = await vscode.workspace.findFiles(
    "**/*.{ts,tsx}",
    "**/{node_modules,out}/**",
    1,
  );

  if (!hasTsConfig && tsFiles.length === 0) {
    vscode.window.showErrorMessage(
      "StoryToTest requires a TypeScript workspace (tsconfig.json or .ts/.tsx files).",
    );
    return false;
  }
  return true;
}

async function collectContext(
  workspacePath: string,
  userStory: string,
  testDir: string,
  progress: vscode.Progress<{ message?: string }>,
): Promise<{ parsed: ReturnType<typeof parseStory>; searchResults: SearchResult; imports: string[] }>
{
  progress.report({ message: "Indexing codebase..." });
  const index = await indexCodebase(workspacePath);
  console.log(
    `Indexed: ${index.interfaces.length} interfaces, ${index.classes.length} classes`,
  );

  progress.report({ message: "Parsing story..." });
  const parsed = parseStory(userStory);
  console.log("=== PARSED STORY ===");
  console.log("Entities:", parsed.entities);
  console.log("Actions:", parsed.actions);

  progress.report({ message: "Searching for components..." });
  const searchResults = searchComponents(index, parsed.entities);
  console.log("=== MATCHED COMPONENTS ===");
  console.log("Interfaces:", searchResults.matchedInterfaces.map((i) => i.name));
  console.log("Classes:", searchResults.matchedClasses.map((c) => c.name));

  const imports = searchResults.matchedInterfaces.map((iface) =>
    resolveImport(iface, testDir),
  );

  return { parsed, searchResults, imports };
}

async function generateWithPreview(
  params: {
    apiKey: string;
    model: string;
    userStory: string;
    framework: TestFramework;
    searchResults: SearchResult;
    testDir: string;
    imports: string[];
    workspacePath: string;
    skipValidation?: boolean;
  },
): Promise<void> {
  const { apiKey, model, userStory, framework, searchResults, testDir, imports, workspacePath, skipValidation } = params;

  let validation:
    | {
        code: string;
        fileName: string;
        attempts: number;
        passed: boolean;
        lastError: string | null;
      }
    | undefined;

  if (skipValidation) {
    const generated = await generateTest(
      apiKey,
      userStory,
      searchResults.matchedInterfaces,
      searchResults.matchedClasses,
      testDir,
      framework,
      imports,
      "",
      model,
    );
    validation = {
      code: generated.code,
      fileName: generated.fileName,
      attempts: 1,
      passed: false,
      lastError: null,
    };
  } else {
    validation = await validateAndFixTest({
      apiKey,
      model,
      userStory,
      searchResults,
      testDir,
      framework,
      imports,
      workspacePath,
      maxAttempts: 3,
      progress: {
        report: ({ message }) => {
          vscode.window.setStatusBarMessage(message || "", 2000);
        },
      },
    });
  }

  const generatedTest = {
    code: validation.code,
    fileName: validation.fileName,
  };

  // Create __tests__ directory if it doesn't exist
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Write the test file
  const testFilePath = path.join(testDir, generatedTest.fileName);
  fs.writeFileSync(testFilePath, generatedTest.code, "utf-8");

  // Open the generated file in editor
  const doc = await vscode.workspace.openTextDocument(testFilePath);
  await vscode.window.showTextDocument(doc);

  // Show success message
  if (skipValidation) {
    vscode.window.showWarningMessage(
      `Test generated without validation (no framework configured). File: ${generatedTest.fileName}`,
    );
  } else if (validation.passed) {
    vscode.window.showInformationMessage(
      `Test generated and validated in ${validation.attempts} attempt(s): ${generatedTest.fileName}`,
    );
  } else {
    vscode.window.showWarningMessage(
      `Test generated but not validated after ${validation.attempts} attempt(s). Check the file for issues: ${generatedTest.fileName}`,
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("StoryToTest is now active");

  const disposable = vscode.commands.registerCommand(
    "storytotest.generateTests",
    async () => {
      // Get user story from input box
      const userStory = await vscode.window.showInputBox({
        prompt: "Paste your user story here",
        placeHolder: "As a user, I can add items to my shopping cart",
        ignoreFocusOut: true,
      });

      if (!userStory) {
        vscode.window.showInformationMessage("No story provided");
        return;
      }

      const workspacePath = getWorkspacePath();
      if (!workspacePath) {
        return;
      }

      const isTypescriptProject = await validateTypeScriptWorkspace(workspacePath);
      if (!isTypescriptProject) {
        return;
      }

      const framework = detectFramework(workspacePath);
      console.log(`Detected test framework: ${framework}`);
      const { framework: effectiveFramework, skipValidation, cancelled } = await resolveFrameworkOrPrompt(
        framework,
        workspacePath,
      );
      if (cancelled) {
        return;
      }

      // Index, search, and generate
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating tests...",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Collecting context..." });
            const testDir = path.join(workspacePath, "__tests__");
            const { searchResults, imports } = await collectContext(
              workspacePath,
              userStory,
              testDir,
              progress,
            );

            if (
              searchResults.matchedInterfaces.length === 0 &&
              searchResults.matchedClasses.length === 0
            ) {
              vscode.window.showWarningMessage(
                "No matching components found for this story. Try different keywords.",
              );
              return;
            }

            // Get API key and model from settings
            const config = vscode.workspace.getConfiguration("storytotest");
            const apiKey = config.get<string>("openaiApiKey");
            const model = config.get<string>("model") || "gpt-4-turbo";

            if (!apiKey) {
              vscode.window.showErrorMessage(
                'OpenAI API key not configured. Go to Settings (Cmd+,) and search for "storytotest"',
              );
              return;
            }

            // Generate test
            progress.report({ message: `Generating ${effectiveFramework} test...` });
            await generateWithPreview({
              apiKey,
              model,
              userStory,
              framework: effectiveFramework,
              searchResults,
              testDir,
              imports,
              workspacePath,
              skipValidation,
            });
          } catch (error) {
            console.error("Error generating test:", error);
            vscode.window.showErrorMessage(
              `Error generating test: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      );
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // Cleanup if needed
}

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

function getWorkspacePath(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage("No workspace folder open");
    return null;
  }
  return workspaceFolders[0].uri.fsPath;
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
  },
): Promise<void> {
  const { apiKey, model, userStory, framework, searchResults, testDir, imports } = params;

  let generatedTest = await generateTest(
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

  console.log("=== GENERATED TEST ===");
  console.log(generatedTest.code);

  // Preview the generated test and ask for confirmation
  const previewDoc = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: generatedTest.code,
  });
  await vscode.window.showTextDocument(previewDoc, { preview: true });

  const choice = await vscode.window.showInformationMessage(
    `Preview generated test: ${generatedTest.fileName}. Save to __tests__?`,
    { modal: false },
    "Accept & Save",
    "Regenerate",
    "Regenerate with more context",
    "Cancel",
  );

  if (choice === "Regenerate" || choice === "Regenerate with more context") {
    const extra =
      choice === "Regenerate with more context"
        ? await vscode.window.showInputBox({
            prompt: "Add more guidance for the generated test",
            placeHolder: "e.g. use React Testing Library, add edge cases for empty data",
          })
        : "";

    const regenerated = await generateTest(
      apiKey,
      userStory,
      searchResults.matchedInterfaces,
      searchResults.matchedClasses,
      testDir,
      framework,
      imports,
      extra || "",
      model,
    );

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      previewDoc.positionAt(0),
      previewDoc.positionAt(previewDoc.getText().length),
    );
    edit.replace(previewDoc.uri, fullRange, regenerated.code);
    await vscode.workspace.applyEdit(edit);

    const confirm = await vscode.window.showInformationMessage(
      `Regenerated test${extra ? " with extra context" : ""}: ${regenerated.fileName}. Save to __tests__?`,
      { modal: false },
      "Accept & Save",
      "Cancel",
    );

    if (confirm !== "Accept & Save") {
      return;
    }

    generatedTest = regenerated;
  } else if (choice !== "Accept & Save") {
    return;
  }

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
  vscode.window.showInformationMessage(`Test generated: ${generatedTest.fileName}`);
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
      if (framework === "unknown") {
        vscode.window.showWarningMessage(
          "Test framework not detected (Jest/Vitest/Playwright). Generated tests may need manual tweaks.",
        );
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
            progress.report({ message: `Generating ${framework} test...` });
            await generateWithPreview({
              apiKey,
              model,
              userStory,
              framework,
              searchResults,
              testDir,
              imports,
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

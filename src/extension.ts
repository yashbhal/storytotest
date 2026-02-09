// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { indexCodebase } from "./codebaseIndexer";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("StoryToTest is now active");

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "storytotest.helloWorld",
    async () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Hello World from storytotest!");
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders) {
        vscode.window.showInformationMessage("No workspace folder open.");
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;
      console.log(`workspace path: ${workspacePath}`);

      // progress while indexing
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Indexing codebase...",
          cancellable: false,
        },
        async () => {
          try {
            const index = await indexCodebase(workspacePath);

            // results
            const message = `Found ${index.interfaces.length} interfaces and ${index.classes.length} classes`;
            vscode.window.showInformationMessage(message);

            // log info to debug console
            console.log("=== INDEXING RESULTS ===");
            console.log("Interfaces: ", index.interfaces);
            console.log("Classes:", index.classes);
          } catch (error) {
            console.error("Error indexing:", error);
            vscode.window.showErrorMessage(`Error indexing: ${error}`);
          }
        },
      );
    },
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { indexCodebase } from "./codebaseIndexer";
import { parseStory } from "./storyParser";
import { searchComponents } from "./componentSearch";

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
      // gets the user story from the input box shown to the user
      const userStory = await vscode.window.showInputBox({
        prompt: "Paste your user story here",
        placeHolder: "As a user, I can add items to my shopping cart",
        ignoreFocusOut: true,
      });

      if (!userStory) {
        vscode.window.showInformationMessage("No user story provided.");
        return;
      }

      // get workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders) {
        vscode.window.showInformationMessage("No workspace folder open.");
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;
      console.log(`workspace path: ${workspacePath}`);

      // index codebase and search
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating tests...",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Indexing codebase..." });
            const index = await indexCodebase(workspacePath);

            // parse story for entities and actions
            progress.report({ message: "Parsing story..." });
            const parsed = parseStory(userStory);

            console.log("=== PARSED STORY ===");
            console.log("Entities: ", parsed.entities);
            console.log("Actions: ", parsed.actions);

            // search index for matching components
            progress.report({ message: "Searching for components..." });
            const searchResults = searchComponents(index, parsed.entities);

            console.log("=== SEARCH RESULTS ===");
            console.log(
              "Matched interfaces: ",
              searchResults.matchedInterfaces,
            );
            console.log("Matched classes: ", searchResults.matchedClasses);

            // results
            const message = `Found ${index.interfaces.length} interfaces and ${index.classes.length} classes`;
            vscode.window.showInformationMessage(message);

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

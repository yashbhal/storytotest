import { Project } from "ts-morph";
import * as fs from "fs";
import * as path from "path";
import { InterfaceInfo, ClassInfo, CodebaseIndex } from "./types";

export { InterfaceInfo, ClassInfo, CodebaseIndex };

// main method that gets the classes, gets the interfaces, pushes them onto the interfaces and then gets everything ready to send
export async function indexCodebase(
  workspacePath: string,
): Promise<CodebaseIndex> {
  console.log(`Starting to index codebase at: ${workspacePath}`);
  const tsConfigPath = path.join(workspacePath, "tsconfig.json");
  const hasTsConfig = fs.existsSync(tsConfigPath);

  // Create a ts-morph project. Use tsconfig when present, otherwise fall back to basic settings.
  const project = hasTsConfig
    ? new Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: true,
      })
    : new Project({
        skipAddingFilesFromTsConfig: true,
      });

  const workspaceGlobRoot = workspacePath.split(path.sep).join("/");
  // Scan TS/TSX files across the workspace while excluding common generated directories.
  project.addSourceFilesAtPaths([
    `${workspaceGlobRoot}/**/*.ts`,
    `${workspaceGlobRoot}/**/*.tsx`,
    `!${workspaceGlobRoot}/**/*.d.ts`,
    `!${workspaceGlobRoot}/**/node_modules/**`,
    `!${workspaceGlobRoot}/**/dist/**`,
    `!${workspaceGlobRoot}/**/build/**`,
    `!${workspaceGlobRoot}/**/out/**`,
    `!${workspaceGlobRoot}/**/.next/**`,
    `!${workspaceGlobRoot}/**/coverage/**`,
    `!${workspaceGlobRoot}/**/.turbo/**`,
  ]);

  const sourceFiles = project.getSourceFiles();
  console.log(`Found ${sourceFiles.length} Typescript files`);

  const interfaces: InterfaceInfo[] = [];
  const classes: ClassInfo[] = [];

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();

    //get interfaces
    const interfaceDeclarations = sourceFile.getInterfaces();

    for (const iface of interfaceDeclarations) {
      const isDefaultExport = iface.isDefaultExport();
      const isExported = iface.isExported() || isDefaultExport;

      const properties = iface.getProperties().map((prop) => ({
        name: prop.getName(),
        type: prop.getType().getText(),
      }));

      interfaces.push({
        name: iface.getName(),
        filePath,
        properties,
        isDefaultExport,
        isExported,
      });
    }

    // get classes
    const classDeclarations = sourceFile.getClasses();

    for (const cls of classDeclarations) {
      const isDefaultExport = cls.isDefaultExport();
      const isExported = cls.isExported() || isDefaultExport;

      const methods = cls.getMethods().map((method) => method.getName());

      classes.push({
        name: cls.getName() || "Anonymous",
        filePath,
        methods,
        isDefaultExport,
        isExported,
      });
    }
  }
  console.log(
    `Extracted ${interfaces.length} interfaces and ${classes.length} classes`,
  );

  return {
    interfaces,
    classes,
  };
}

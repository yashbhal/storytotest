import { Project, SourceFile } from "ts-morph";
import * as path from "path";

//one interface for interfaces
export interface InterfaceInfo {
  name: string;
  filePath: string;
  properties: Array<{
    name: string;
    type: string;
  }>;
}

//one interface for classes
export interface ClassInfo {
  name: string;
  filePath: string;
  methods: string[];
}

export interface CodebaseIndex {
  interfaces: InterfaceInfo[];
  classes: ClassInfo[];
}

// main method that gets the classes, gets the interfaces, pushes them onto the interfaces and then gets everything ready to send
export async function indexCodebase(
  workspacePath: string,
): Promise<CodebaseIndex> {
  console.log(`Starting to index codebase at: ${workspacePath}`);

  // make a ts-morph project
  const project = new Project({
    tsConfigFilePath: path.join(workspacePath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true, // skipping so its possible to manually add files
  });

  // add all source files to the project
  project.addSourceFilesAtPaths([
    path.join(workspacePath, "src/**/*.ts"),
    path.join(workspacePath, "src/**/*.tsx"),
    path.join(workspacePath, "app/**/*.ts"), // Add this
    path.join(workspacePath, "app/**/*.tsx"), // Add this
    path.join(workspacePath, "lib/**/*.ts"), // Common folder
    path.join(workspacePath, "lib/**/*.tsx"),
    path.join(workspacePath, "components/**/*.ts"), // Another common pattern
    path.join(workspacePath, "components/**/*.tsx"),
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
      const properties = iface.getProperties().map((prop) => ({
        name: prop.getName(),
        type: prop.getType().getText(),
      }));

      interfaces.push({
        name: iface.getName(),
        filePath,
        properties,
      });
    }

    // get classes
    const classDeclarations = sourceFile.getClasses();

    for (const cls of classDeclarations) {
      const methods = cls.getMethods().map((method) => method.getName());

      classes.push({
        name: cls.getName() || "Anonymous",
        filePath,
        methods,
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

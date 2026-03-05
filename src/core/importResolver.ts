import * as path from "path";
import { InterfaceInfo } from "./types";

/**
 * Builds a relative import statement for an interface from the test directory to its source file.
 * Example output: `import { BlogCardProps } from "../app/components/BlogCard";`
 * @param interfaceInfo metadata about the interface (name, file path, export flags)
 * @param testDir absolute path to the test directory where the import will be used
 * @returns an ES module import line with normalized POSIX separators
 */
export function resolveImport(interfaceInfo: InterfaceInfo, testDir: string): string {
  const relativePathWithExt = path.relative(testDir, interfaceInfo.filePath);
  const withoutExt = relativePathWithExt.replace(/\.tsx?|\.jsx?$/, "");

  // Normalize to POSIX-style separators for import paths.
  const normalized = withoutExt.split(path.sep).join("/");
  const importPath = normalized.startsWith(".") ? normalized : `./${normalized}`;

  const name = interfaceInfo.name || "DefaultExport";

  if (interfaceInfo.isDefaultExport) {
    return `import ${name} from "${importPath}";`;
  }

  return `import { ${name} } from "${importPath}";`;
}

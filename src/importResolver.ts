import * as path from "path";
import { InterfaceInfo } from "./codebaseIndexer";

// Resolves a relative import statement for a given interface into the target test directory.
// Example output: import { BlogCardProps } from "../app/components/BlogCard";
export function resolveImport(interfaceInfo: InterfaceInfo, testDir: string): string {
  const relativePathWithExt = path.relative(testDir, interfaceInfo.filePath);
  const withoutExt = relativePathWithExt.replace(/\.(tsx?|jsx?)$/, "");

  // Normalize to POSIX-style separators for import paths.
  const normalized = withoutExt.split(path.sep).join("/");
  const importPath = normalized.startsWith(".") ? normalized : `./${normalized}`;

  return `import { ${interfaceInfo.name} } from "${importPath}";`;
}

import * as fs from "fs";
import * as path from "path";

export type TestFramework = "jest" | "vitest" | "playwright" | "unknown";

function hasDependency(pkg: any, name: string): boolean {
  return Boolean(
    (pkg.dependencies && pkg.dependencies[name]) ||
      (pkg.devDependencies && pkg.devDependencies[name]),
  );
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function detectFramework(workspacePath: string): TestFramework {
  const pkgPath = path.join(workspacePath, "package.json");

  let pkg: any = {};
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    pkg = JSON.parse(raw);
  } catch {
    // ignore parse/read errors; fall through to unknown
  }

  // Dependency-based detection
  if (hasDependency(pkg, "vitest")) return "vitest";
  if (hasDependency(pkg, "jest") || hasDependency(pkg, "@jest/globals")) return "jest";
  if (hasDependency(pkg, "playwright") || hasDependency(pkg, "@playwright/test"))
    return "playwright";

  // Config file-based detection
  const jestConfigFiles = ["jest.config.js", "jest.config.ts", "jest.config.cjs", "jest.config.mjs"];
  for (const file of jestConfigFiles) {
    if (fileExists(path.join(workspacePath, file))) {
      return "jest";
    }
  }

  const vitestConfigFiles = ["vitest.config.ts", "vitest.config.js", "vite.config.ts", "vite.config.js"];
  for (const file of vitestConfigFiles) {
    if (fileExists(path.join(workspacePath, file))) {
      return "vitest";
    }
  }

  const playwrightConfigFiles = [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
    "playwright.config.cjs",
  ];
  for (const file of playwrightConfigFiles) {
    if (fileExists(path.join(workspacePath, file))) {
      return "playwright";
    }
  }

  return "unknown";
}

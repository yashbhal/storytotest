import OpenAI from "openai";
import { InterfaceInfo, ClassInfo, GeneratedTest } from "./types";
import { TestFramework } from "./frameworkDetector";

export { GeneratedTest };

export async function generateTest(
  apiKey: string,
  story: string,
  matchedInterfaces: InterfaceInfo[],
  matchedClasses: ClassInfo[],
  testDir: string,
  framework: TestFramework,
  imports: string[],
  extraInstructions: string = "",
  model: string = "gpt-4-turbo",
): Promise<GeneratedTest> {
  const openai = new OpenAI({ apiKey });

  const dedupedImports = Array.from(new Set(imports));
  const importStatements = dedupedImports.join("\n");

  const frameworkImports = (() => {
    switch (framework) {
      case "vitest":
        return "import { describe, it, expect, vi } from \"vitest\";";
      case "jest":
        return "import { describe, it, expect, jest } from \"@jest/globals\";";
      case "playwright":
        return "import { test, expect } from \"@playwright/test\";";
      default:
        return "";
    }
  })();

  // Build context from matched interfaces with file paths
  const interfaceContext = matchedInterfaces
    .map((iface) => {
      const props = iface.properties
        .map((p) => `  ${p.name}: ${p.type};`)
        .join("\n");
      const exportNote = iface.isExported
        ? "// exported"
        : "// not exported in source; do NOT import";
      return `${exportNote}\n// From: ${iface.filePath}\ninterface ${iface.name} {\n${props}\n}`;
    })
    .join("\n\n");

  // Build context from matched classes
  const classContext = matchedClasses
    .map((cls) => {
      const methods = cls.methods.join(", ");
      return `// From: ${cls.filePath}\nclass ${cls.name} {\n  // Methods: ${methods}\n}`;
    })
    .join("\n\n");

  // System prompt: Define AI behavior and rules
  const systemPrompt = `You are an expert TypeScript test generator specializing in Jest, Vitest, and Playwright.

Your role:
- Generate comprehensive, production-quality test suites
- Use TypeScript types correctly and strictly
- Follow testing best practices
- Write clear, maintainable test code

Rules:
1. Use the provided TypeScript interfaces exactly as shown
2. Write descriptive test names that explain what is being tested
3. Include proper setup/teardown (beforeEach, afterEach) when needed
4. Mock external dependencies appropriately
5. Use type-safe test data
6. Generate complete, runnable tests with all necessary imports
7. Follow the Arrange-Act-Assert pattern
8. Use the ${framework} test style${
    framework === "vitest"
      ? " (describe/it or test.describe when grouping; vi for mocks)"
      : framework === "playwright"
        ? " (use test() with fixtures; expect from @playwright/test)"
        : ""
  }`;

  // User prompt: The specific task with context
  const userPrompt = `Generate tests for this user story:

"${story}"

## Relevant Types from Codebase

We've indexed the codebase and found these types that are relevant to this story:

${interfaceContext}

${classContext ? `\n## Relevant Classes\n\n${classContext}` : ""}

## Instructions

- These are not all types in the codebase, just the ones matching the story
- You may import additional types if the tests require them
- Generate realistic test data that matches the interface properties
- Write tests that verify the story's acceptance criteria
// Only import types that are exported from their modules. If a type is noted as "not exported", do not import it; rely on component usage or inline types instead.
${extraInstructions ? `\n- Additional guidance: ${extraInstructions}` : ""}

## Generate a complete test file with:

1. **Imports**: Import types from their file paths (use relative imports)
${importStatements ? `\nUse these imports:\n${importStatements}\n` : ""}
${frameworkImports ? `Framework imports (add if missing):\n${frameworkImports}\n` : ""}
2. **Test Suite**: Use describe() to group related tests
3. **Test Cases**: Use it() or test() for individual test cases
4. **Type-Safe Data**: Create test data using the provided interfaces
5. **Assertions**: Clear expect() statements that validate the story
6. **Setup/Teardown**: Use beforeEach/afterEach if needed`;

  // Call OpenAI API
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3, // Lower = more consistent/predictable
    max_tokens: 2000,
  });

  const generatedCode = response.choices[0].message.content || "";

  // Extract code from markdown if present
  let code = generatedCode;
  const codeMatch = generatedCode.match(
    /```(?:typescript|ts)?\n([\s\S]*?)\n```/,
  );
  if (codeMatch) {
    code = codeMatch[1];
  }

  // Prepend deterministic imports (framework + resolved interfaces)
  const header = [frameworkImports, importStatements].filter(Boolean).join("\n");
  if (header) {
    code = `${header}\n\n${code}`;
  }

  // Dedupe imports (framework + model-generated) and keep them at top
  {
    const lines = code.split("\n");
    const seen = new Set<string>();
    const frameworkModules = new Set(["vitest", "@jest/globals", "@playwright/test"]);
    const frameworkModuleSeen = new Set<string>();
    const importLines: string[] = [];
    const otherLines: string[] = [];

    for (const line of lines) {
      if (/^\s*import\s/.test(line)) {
        const normalized = line.replace(/\s+/g, " ").trim();

        const moduleMatch = normalized.match(/from ["']([^"']+)["']/);
        const modulePath = moduleMatch?.[1];
        if (modulePath && frameworkModules.has(modulePath)) {
          if (frameworkModuleSeen.has(modulePath)) {
            continue; // drop duplicate framework import for same module
          }
          frameworkModuleSeen.add(modulePath);
        }

        if (!seen.has(normalized)) {
          seen.add(normalized);
          importLines.push(line);
        }
      } else {
        otherLines.push(line);
      }
    }

    code = [...importLines, "", ...otherLines].join("\n").trim();
  }

  // Generate filename based on first matched interface or class
  let baseName = "generated";
  if (matchedInterfaces.length > 0) {
    baseName = matchedInterfaces[0].name.replace(/Props|Interface|Type/g, "");
  } else if (matchedClasses.length > 0) {
    baseName = matchedClasses[0].name;
  }

  const fileName = `${baseName}.test.tsx`;

  return {
    code,
    fileName,
  };
}

# Core Modules

This document details the core business logic modules that power test generation, validation, and code analysis.

## Module Overview

```
src/core/
├── storyParser.ts         # Extract entities from user stories
├── codebaseIndexer.ts     # Scan TypeScript files
├── componentSearch.ts     # Match entities to code
├── testGenerator.ts       # Generate test code via LLM
├── testValidator.ts       # Validate and fix tests
├── testRunner.ts          # Execute test files
├── frameworkDetector.ts   # Detect test framework
├── importResolver.ts      # Generate import statements
└── types.ts               # Shared type definitions
```

---

## Story Parser

**Location**: `src/core/storyParser.ts`

**Purpose**: Extract meaningful keywords and actions from natural language user stories.

### Function Signature

```typescript
function parseStory(storyText: string): ParsedStory
```

### Algorithm

**Step 1: Extract Quoted Text**
```typescript
const quotedMatches = storyText.match(/"([^"]+)"/g);
```
Anything in quotes is considered an important entity.

Example: `"BlogCard"` → `blogcard`

**Step 2: Extract Meaningful Words**

Filter criteria:
- Length > 3 characters
- Not in stopword list
- Not already extracted

Stopwords (56 total):
```
a, an, the, can, should, will, would, could, as, to, from, with,
and, or, but, in, on, at, by, for, of, is, are, was, were, been,
be, have, has, had, do, does, did, new, old
```

**Step 3: Extract Action Verbs**

Recognized actions:
```
add, remove, delete, create, update, view, edit, search, filter
```

### Return Type

```typescript
interface ParsedStory {
  rawText: string;      // Original story text
  entities: string[];   // Extracted keywords (deduplicated)
  actions: string[];    // Extracted action verbs (deduplicated)
}
```

### Examples

**Input 1**:
```
As a user, I want to view the "BlogCard" component with title and description
```

**Output 1**:
```typescript
{
  rawText: "As a user, I want to view the \"BlogCard\" component with title and description",
  entities: ["user", "view", "blogcard", "component", "title", "description"],
  actions: ["view"]
}
```

**Input 2**:
```
Add search functionality to filter blog posts by category
```

**Output 2**:
```typescript
{
  rawText: "Add search functionality to filter blog posts by category",
  entities: ["search", "functionality", "filter", "blog", "posts", "category"],
  actions: ["add", "search", "filter"]
}
```

---

## Codebase Indexer

**Location**: `src/core/codebaseIndexer.ts`

**Purpose**: Scan all TypeScript files and extract interfaces and classes with their properties/methods.

### Function Signature

```typescript
async function indexCodebase(workspacePath: string): Promise<CodebaseIndex>
```

### Process

**Step 1: Initialize ts-morph Project**

```typescript
const tsConfigPath = path.join(workspacePath, "tsconfig.json");
const hasTsConfig = fs.existsSync(tsConfigPath);

const project = hasTsConfig
  ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true })
  : new Project({ skipAddingFilesFromTsConfig: true });
```

Uses `tsconfig.json` if present for accurate type resolution.

**Step 2: Add Source Files**

Glob patterns:
```typescript
[
  `${workspaceGlobRoot}/**/*.ts`,
  `${workspaceGlobRoot}/**/*.tsx`,
  `!${workspaceGlobRoot}/**/*.d.ts`,
  `!${workspaceGlobRoot}/**/node_modules/**`,
  `!${workspaceGlobRoot}/**/dist/**`,
  `!${workspaceGlobRoot}/**/build/**`,
  `!${workspaceGlobRoot}/**/out/**`,
  `!${workspaceGlobRoot}/**/.next/**`,
  `!${workspaceGlobRoot}/**/coverage/**`,
  `!${workspaceGlobRoot}/**/.turbo/**`
]
```

Excludes common generated/dependency directories.

**Step 3: Extract Interfaces**

For each source file:
```typescript
const interfaceDeclarations = sourceFile.getInterfaces();

for (const iface of interfaceDeclarations) {
  const properties = iface.getProperties().map(prop => ({
    name: prop.getName(),
    type: prop.getType().getText()
  }));
  
  interfaces.push({
    name: iface.getName(),
    filePath: sourceFile.getFilePath(),
    properties,
    isDefaultExport: iface.isDefaultExport(),
    isExported: iface.isExported() || iface.isDefaultExport()
  });
}
```

**Step 4: Extract Classes**

```typescript
const classDeclarations = sourceFile.getClasses();

for (const cls of classDeclarations) {
  const methods = cls.getMethods().map(method => method.getName());
  
  classes.push({
    name: cls.getName() || "Anonymous",
    filePath: sourceFile.getFilePath(),
    methods,
    isDefaultExport: cls.isDefaultExport(),
    isExported: cls.isExported() || cls.isDefaultExport()
  });
}
```

### Return Type

```typescript
interface CodebaseIndex {
  interfaces: InterfaceInfo[];
  classes: ClassInfo[];
}

interface InterfaceInfo {
  name: string;
  filePath: string;
  properties: Array<{ name: string; type: string }>;
  isDefaultExport: boolean;
  isExported: boolean;
}

interface ClassInfo {
  name: string;
  filePath: string;
  methods: string[];
  isDefaultExport: boolean;
  isExported: boolean;
}
```

### Example Output

```typescript
{
  interfaces: [
    {
      name: "BlogCardProps",
      filePath: "/workspace/src/components/BlogCard.tsx",
      properties: [
        { name: "title", type: "string" },
        { name: "description", type: "string" },
        { name: "imageUrl", type: "string | undefined" },
        { name: "onClick", type: "() => void" }
      ],
      isDefaultExport: false,
      isExported: true
    }
  ],
  classes: [
    {
      name: "BlogService",
      filePath: "/workspace/src/services/BlogService.ts",
      methods: ["fetchBlogs", "createBlog", "updateBlog", "deleteBlog"],
      isDefaultExport: true,
      isExported: true
    }
  ]
}
```

### Performance

Typical performance:
- 100 files: ~1-2 seconds
- 500 files: ~3-5 seconds
- 1000 files: ~6-10 seconds

Logs: `Found ${n} Typescript files` and `Extracted ${i} interfaces and ${c} classes`

---

## Component Search

**Location**: `src/core/componentSearch.ts`

**Purpose**: Match extracted story entities to actual code interfaces and classes.

### Function Signature

```typescript
function searchComponents(
  codebaseIndex: CodebaseIndex,
  entities: string[]
): SearchResult
```

### Algorithm

**Matching Logic**:
```typescript
for (const entity of entities) {
  for (const interface of codebaseIndex.interfaces) {
    if (interface.name.toLowerCase().includes(entity.toLowerCase())) {
      matchedInterfaces.push(interface);
    }
  }
  
  for (const class of codebaseIndex.classes) {
    if (class.name.toLowerCase().includes(entity.toLowerCase())) {
      matchedClasses.push(class);
    }
  }
}
```

Case-insensitive substring matching.

### Return Type

```typescript
interface SearchResult {
  matchedInterfaces: InterfaceInfo[];
  matchedClasses: ClassInfo[];
}
```

### Examples

**Example 1: Direct Match**
```
Entities: ["blogcard"]
Codebase: [BlogCardProps, UserProfile, BlogService]

Result:
- matchedInterfaces: [BlogCardProps]
- matchedClasses: [BlogService]
```

**Example 2: Partial Match**
```
Entities: ["user", "profile"]
Codebase: [UserProfile, UserSettings, ProfileService]

Result:
- matchedInterfaces: [UserProfile, UserSettings]
- matchedClasses: [ProfileService]
```

**Example 3: No Match**
```
Entities: ["dashboard"]
Codebase: [BlogCardProps, UserProfile]

Result:
- matchedInterfaces: []
- matchedClasses: []
```

### Deduplication

Results are automatically deduplicated if multiple entities match the same component.

---

## Import Resolver

**Location**: `src/core/importResolver.ts`

**Purpose**: Generate correct import statements for matched interfaces.

### Function Signature

```typescript
function resolveImport(interfaceInfo: InterfaceInfo, testDir: string): string
```

### Algorithm

**Step 1: Calculate Relative Path**
```typescript
const relativePathWithExt = path.relative(testDir, interfaceInfo.filePath);
// Example: "../src/components/BlogCard.tsx"
```

**Step 2: Remove Extension**
```typescript
const withoutExt = relativePathWithExt.replace(/\.tsx?|\.jsx?$/, "");
// Example: "../src/components/BlogCard"
```

**Step 3: Normalize Path Separators**
```typescript
const normalized = withoutExt.split(path.sep).join("/");
// Ensures POSIX-style paths for imports
```

**Step 4: Ensure Leading Dot**
```typescript
const importPath = normalized.startsWith(".") ? normalized : `./${normalized}`;
```

**Step 5: Generate Import Statement**
```typescript
if (interfaceInfo.isDefaultExport) {
  return `import ${name} from "${importPath}";`;
} else {
  return `import { ${name} } from "${importPath}";`;
}
```

### Examples

**Example 1: Named Export**
```
Interface: BlogCardProps in /workspace/src/components/BlogCard.tsx
Test Dir: /workspace/__tests__
Is Default Export: false

Output: import { BlogCardProps } from "../src/components/BlogCard";
```

**Example 2: Default Export**
```
Interface: BlogCard in /workspace/src/components/BlogCard.tsx
Test Dir: /workspace/__tests__
Is Default Export: true

Output: import BlogCard from "../src/components/BlogCard";
```

**Example 3: Same Directory**
```
Interface: UserProfile in /workspace/__tests__/fixtures/UserProfile.ts
Test Dir: /workspace/__tests__
Is Default Export: false

Output: import { UserProfile } from "./fixtures/UserProfile";
```

---

## Framework Detector

**Location**: `src/core/frameworkDetector.ts`

**Purpose**: Identify which test framework is used in the project.

### Function Signature

```typescript
function detectFramework(workspacePath: string): TestFramework

type TestFramework = "jest" | "vitest" | "playwright" | "unknown";
```

### Detection Strategy

**Step 1: Read package.json**
```typescript
const pkgPath = path.join(workspacePath, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const allDeps = {
  ...pkg.dependencies,
  ...pkg.devDependencies
};
```

**Step 2: Check for Framework Packages**

Priority order:
1. **Playwright**: Check for `@playwright/test`
2. **Vitest**: Check for `vitest`
3. **Jest**: Check for `jest`

**Step 3: Verify with Config Files**

Additional validation by checking for config files:

| Framework | Config Files |
|-----------|-------------|
| Jest | `jest.config.js`, `jest.config.ts`, `jest.config.json` |
| Vitest | `vitest.config.js`, `vitest.config.ts` |
| Playwright | `playwright.config.js`, `playwright.config.ts` |

### Return Values

- `"jest"` - Jest detected
- `"vitest"` - Vitest detected
- `"playwright"` - Playwright detected
- `"unknown"` - No framework found

### Framework Capabilities

| Framework | Validation Supported | Default Test Dir |
|-----------|---------------------|-----------------|
| Jest | Yes | `__tests__` |
| Vitest | Yes | `__tests__` |
| Playwright | No | `tests` |
| Unknown | No | `__tests__` |

---

## Test Generator

**Location**: `src/core/testGenerator.ts`

**Purpose**: Use LLM to generate test code based on user story and matched components.

### Function Signature

```typescript
async function generateTest(
  apiKey: string,
  userStory: string,
  matchedInterfaces: InterfaceInfo[],
  matchedClasses: ClassInfo[],
  testDir: string,
  framework: TestFramework,
  imports: string[],
  additionalContext: string,
  model: string,
  options: { provider: LLMProvider; baseUrl?: string }
): Promise<GeneratedTest>
```

### Process

**Step 1: Build System Prompt**

```typescript
const systemPrompt = `You are a test code generator. Generate ${framework} tests.

Rules:
- Use ${framework} syntax and best practices
- Include necessary imports
- Write clear, descriptive test names
- Test all major functionality
- Handle edge cases
- Use proper assertions
- Return ONLY the test code, no explanations
`;
```

**Step 2: Build User Prompt**

```typescript
const userPrompt = `
User Story:
${userStory}

Matched Interfaces:
${matchedInterfaces.map(i => `
  interface ${i.name} {
    ${i.properties.map(p => `${p.name}: ${p.type}`).join('\n    ')}
  }
`).join('\n')}

Matched Classes:
${matchedClasses.map(c => `
  class ${c.name} {
    methods: ${c.methods.join(', ')}
  }
`).join('\n')}

Required Imports:
${imports.join('\n')}

Additional Context:
${additionalContext}

Generate a complete test file.
`;
```

**Step 3: Call LLM**

Uses OpenAI SDK with provider-specific configuration:

```typescript
const openai = new OpenAI({
  apiKey,
  baseURL: baseUrl || providerBaseUrls[provider]
});

const completion = await openai.chat.completions.create({
  model,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ],
  temperature: 0.2 // Low temperature for consistent output
});
```

**Step 4: Extract Code**

```typescript
const rawCode = completion.choices[0].message.content;
const codeMatch = rawCode.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)\n```/);
const code = codeMatch ? codeMatch[1] : rawCode;
```

Handles both fenced code blocks and raw code.

**Step 5: Deduplicate Imports**

```typescript
function deduplicateImports(code: string): string {
  const lines = code.split('\n');
  const importLines = new Set<string>();
  const otherLines: string[] = [];
  
  for (const line of lines) {
    if (line.trim().startsWith('import ')) {
      importLines.add(line);
    } else {
      otherLines.push(line);
    }
  }
  
  return [...importLines, '', ...otherLines].join('\n');
}
```

**Step 6: Generate Filename**

```typescript
const fileName = `${sanitize(userStory.split(' ')[0])}.test.${framework === 'playwright' ? 'spec' : 'test'}.ts`;
```

### Return Type

```typescript
interface GeneratedTest {
  code: string;      // Complete test file content
  fileName: string;  // Generated filename
}
```

### Example Generated Test

```typescript
import { render, screen } from '@testing-library/react';
import { BlogCardProps } from '../src/components/BlogCard';
import BlogCard from '../src/components/BlogCard';

describe('BlogCard Component', () => {
  it('should render with title and description', () => {
    const props: BlogCardProps = {
      title: 'Test Title',
      description: 'Test Description',
      onClick: jest.fn()
    };
    
    render(<BlogCard {...props} />);
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });
  
  it('should call onClick when clicked', () => {
    const mockOnClick = jest.fn();
    const props: BlogCardProps = {
      title: 'Test Title',
      description: 'Test Description',
      onClick: mockOnClick
    };
    
    render(<BlogCard {...props} />);
    
    const card = screen.getByRole('button');
    card.click();
    
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });
});
```

---

## Test Validator

**Location**: `src/core/testValidator.ts`

**Purpose**: Iteratively run and fix generated tests until they pass.

### Function Signature

```typescript
async function validateAndFixTest(params: {
  apiKey: string;
  model: string;
  provider: LLMProvider;
  baseUrl?: string;
  userStory: string;
  searchResults: SearchResult;
  testDir: string;
  framework: TestFramework;
  imports: string[];
  workspacePath: string;
  maxAttempts: number;
}): Promise<ValidationResult>
```

### Validation Loop

```
┌─────────────────────────────────┐
│  Generate Test (attempt 1)      │
└──────────────┬──────────────────┘
               │
               v
┌──────────────────────────────────┐
│  Write to Temp File              │
│  ${testDir}/.storytotest-temp.ts │
└──────────────┬───────────────────┘
               │
               v
┌──────────────────────────────────┐
│  Run Test                        │
│  (Jest/Vitest)                   │
└──────────────┬───────────────────┘
               │
        ┌──────┴──────┐
        │             │
    [Pass]        [Fail]
        │             │
        v             v
    Success    ┌──────────────────┐
               │ Extract Error    │
               │ Send to LLM      │
               │ Request Fix      │
               └────────┬─────────┘
                        │
                        v
                  [Attempt < Max?]
                        │
                   ┌────┴────┐
                  Yes       No
                   │         │
                   └─────┐   v
                         │ Failed
                         │
                    (Loop back)
```

### Process Details

**Step 1: Generate Initial Test**
```typescript
let generated = await generateTest(
  apiKey, userStory, searchResults.matchedInterfaces,
  searchResults.matchedClasses, testDir, framework,
  imports, "Generate a passing test.", model,
  { provider, baseUrl }
);
```

**Step 2: Write Temp File**
```typescript
const tempFilePath = path.join(testDir, ".storytotest-temp.ts");
fs.writeFileSync(tempFilePath, generated.code, "utf-8");
```

**Step 3: Run Test**
```typescript
const result = await runTest(tempFilePath, framework, workspacePath);
```

**Step 4: Check Result**
```typescript
if (result.passed) {
  return {
    code: generated.code,
    fileName: generated.fileName,
    attempts: attempt,
    passed: true,
    lastError: null
  };
}
```

**Step 5: Fix on Failure**
```typescript
const fixPrompt = `
The test failed with this error:
${result.error}

Original test code:
${generated.code}

Fix the test to make it pass. Return only the corrected code.
`;

generated = await generateTest(
  apiKey, fixPrompt, [], [], testDir, framework,
  [], "Fix the failing test.", model,
  { provider, baseUrl }
);
```

**Step 6: Repeat**

Loop continues until test passes or `maxAttempts` reached.

### Return Type

```typescript
interface ValidationResult {
  code: string;         // Final test code
  fileName: string;     // Test filename
  attempts: number;     // Number of attempts taken
  passed: boolean;      // Did test pass?
  lastError: string | null;  // Last error if failed
}
```

### Common Fixes

The LLM typically fixes:
1. Missing imports
2. Incorrect mock syntax
3. Wrong assertion methods
4. Type errors
5. Async/await issues
6. DOM query mistakes

---

## Test Runner

**Location**: `src/core/testRunner.ts`

**Purpose**: Execute test files using the detected framework.

### Function Signature

```typescript
async function runTest(
  testFilePath: string,
  framework: TestFramework,
  workspacePath: string
): Promise<TestResult>
```

### Execution Commands

| Framework | Command |
|-----------|---------|
| Jest | `npx jest ${testFilePath} --no-coverage` |
| Vitest | `npx vitest run ${testFilePath} --no-coverage` |
| Playwright | Not supported (returns skipped) |

### Process

```typescript
const command = framework === "jest"
  ? `npx jest ${testFilePath} --no-coverage`
  : `npx vitest run ${testFilePath} --no-coverage`;

try {
  execSync(command, {
    cwd: workspacePath,
    stdio: "pipe",
    encoding: "utf-8"
  });
  
  return { passed: true, error: null };
} catch (err) {
  return {
    passed: false,
    error: err.stderr || err.stdout || err.message
  };
}
```

### Return Type

```typescript
interface TestResult {
  passed: boolean;
  error: string | null;
}
```

### Error Output

Captures full stderr/stdout for LLM analysis:
```
FAIL  __tests__/.storytotest-temp.ts
  ● BlogCard Component › should render with title

    ReferenceError: BlogCard is not defined

      4 | describe('BlogCard Component', () => {
      5 |   it('should render with title', () => {
    > 6 |     render(<BlogCard title="Test" />);
        |             ^
      7 |   });
      8 | });
```

---

## Type Definitions

**Location**: `src/core/types.ts`

Shared TypeScript interfaces used across all modules.

### Key Types

```typescript
// Story parsing
interface ParsedStory {
  rawText: string;
  entities: string[];
  actions: string[];
}

// Codebase indexing
interface InterfaceInfo {
  name: string;
  filePath: string;
  properties: Array<{ name: string; type: string }>;
  isDefaultExport: boolean;
  isExported: boolean;
}

interface ClassInfo {
  name: string;
  filePath: string;
  methods: string[];
  isDefaultExport: boolean;
  isExported: boolean;
}

interface CodebaseIndex {
  interfaces: InterfaceInfo[];
  classes: ClassInfo[];
}

// Component search
interface SearchResult {
  matchedInterfaces: InterfaceInfo[];
  matchedClasses: ClassInfo[];
}

// Test generation
interface GeneratedTest {
  code: string;
  fileName: string;
}

// Test validation
interface ValidationResult {
  code: string;
  fileName: string;
  attempts: number;
  passed: boolean;
  lastError: string | null;
}

// Test execution
interface TestResult {
  passed: boolean;
  error: string | null;
}

// Framework detection
type TestFramework = "jest" | "vitest" | "playwright" | "unknown";
```

---

## Related Documentation

- [[00-Overview]] - System architecture
- [[01-Workflow-Process]] - How modules work together
- [[04-LLM-Integration]] - Language model details

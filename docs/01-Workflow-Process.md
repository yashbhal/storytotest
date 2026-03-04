# Workflow Process - Step by Step

This document explains the complete workflow from receiving a user story to creating a pull request with generated tests.

## Main Workflow Function

**Location**: `src/integrations/githubWorkflow.ts`

**Function**: `processGitHubIssue(issue, config)`

This is the orchestrator that coordinates all steps. It uses structured logging with `[issue #N][step]` prefixes for observability.

## Complete Workflow Steps

### Step 1: Extract Story from Issue

**Code Location**: `githubWorkflow.ts:76-77`

```typescript
const storyText = [issue.title, issue.body ?? ""].join("\n").trim();
```

Combines the GitHub issue title and body into a single text string for parsing.

**Example Input**:
```
Title: Add BlogCard component tests
Body: As a user, I want to see the BlogCard with title and description
```

**Output**: Single concatenated string

---

### Step 2: Detect Test Framework

**Code Location**: `githubWorkflow.ts:80-90`

**Module**: `src/core/frameworkDetector.ts`

```typescript
let framework = detectFramework(config.workspaceRoot);
```

Scans the workspace to identify which test framework is in use:

**Detection Logic**:
1. Read `package.json` dependencies
2. Check for framework-specific config files
3. Return framework type: `jest`, `vitest`, `playwright`, or `unknown`

**Framework Detection Table**:

| Framework | Package Name | Config Files |
|-----------|-------------|--------------|
| Jest | `jest` | `jest.config.js/ts` |
| Vitest | `vitest` | `vitest.config.js/ts` |
| Playwright | `@playwright/test` | `playwright.config.js/ts` |

**Optional Scaffolding**:
If framework is `unknown` and `ALLOW_SCAFFOLD_VITEST=true`:
- Creates `vitest.config.ts` with minimal config
- Creates `test/setupTests.ts` as setup file
- Sets framework to `vitest`

**Code**: `githubWorkflow.ts:430-461`

---

### Step 3: Index Codebase

**Code Location**: `githubWorkflow.ts:98-99`

**Module**: `src/core/codebaseIndexer.ts`

```typescript
const codebaseIndex = await indexCodebase(config.workspaceRoot);
```

Scans all TypeScript files to build a complete catalog of interfaces and classes.

**Process**:
1. Initialize `ts-morph` project (uses `tsconfig.json` if present)
2. Add all `.ts` and `.tsx` files (excluding `node_modules`, `dist`, etc.)
3. Extract interfaces with properties
4. Extract classes with methods
5. Track export status for each

**Example Output**:
```typescript
{
  interfaces: [
    {
      name: "BlogCardProps",
      filePath: "/workspace/src/components/BlogCard.tsx",
      properties: [
        { name: "title", type: "string" },
        { name: "description", type: "string" }
      ],
      isExported: true,
      isDefaultExport: false
    }
  ],
  classes: [
    {
      name: "BlogService",
      filePath: "/workspace/src/services/BlogService.ts",
      methods: ["fetchBlogs", "createBlog"],
      isExported: true,
      isDefaultExport: false
    }
  ]
}
```

**Performance**: Logs total files scanned and entities extracted

---

### Step 4: Parse Story Entities

**Code Location**: `githubWorkflow.ts:102-104`

**Module**: `src/core/storyParser.ts`

```typescript
const parsedStory = parseStory(storyText);
```

Extracts meaningful keywords from the user story.

**Parsing Strategy**:

1. **Quoted Text**: Extract anything in quotes
   - `"BlogCard"` → `blogcard`

2. **Meaningful Words**: Words longer than 3 characters, excluding stopwords
   - Stopwords: `the`, `a`, `can`, `should`, `will`, `with`, etc.
   - `component` → `component`
   - `title` → `title`

3. **Action Verbs**: Specific action keywords
   - Actions: `add`, `remove`, `create`, `update`, `view`, `edit`, `search`, `filter`

**Example**:
```
Input: "As a user, I want to view the BlogCard component with title"

Output: {
  rawText: "As a user, I want to view the BlogCard component with title",
  entities: ["user", "view", "blogcard", "component", "title"],
  actions: ["view"]
}
```

**Code**: `storyParser.ts:5-99`

---

### Step 5: Search for Matching Components

**Code Location**: `githubWorkflow.ts:107-109`

**Module**: `src/core/componentSearch.ts`

```typescript
const searchResults = searchComponents(codebaseIndex, parsedStory.entities);
```

Matches extracted entities to actual code elements.

**Matching Logic**:
- For each interface/class name, check if any entity is contained in the name (case-insensitive)
- Example: entity `blogcard` matches interface `BlogCardProps`

**Example**:
```typescript
Entities: ["blogcard", "title"]
Codebase: [BlogCardProps, UserProfile, BlogService]

Matches:
- BlogCardProps (contains "blogcard")
- BlogService (contains "blog")
```

**Early Exit**: If no matches found, post comment to issue and return early

---

### Step 6: Resolve Imports

**Code Location**: `githubWorkflow.ts:132-134`

**Module**: `src/core/importResolver.ts`

```typescript
const imports = searchResults.matchedInterfaces
  .filter((iface) => iface.isExported)
  .map((iface) => resolveImport(iface, testDir));
```

Generates import statements for matched interfaces.

**Logic**:
1. Calculate relative path from test directory to source file
2. Remove file extension
3. Normalize to POSIX-style path separators
4. Generate import statement (default vs named export)

**Example**:
```typescript
Interface: BlogCardProps in /workspace/src/components/BlogCard.tsx
Test Dir: /workspace/__tests__

Output: import { BlogCardProps } from "../src/components/BlogCard";
```

---

### Step 7: Check for Missing Dependencies

**Code Location**: `githubWorkflow.ts:138-140`

**Function**: `detectMissingValidationDeps()`

Before attempting validation, check if required test dependencies are installed.

**Dependencies Checked**:

| Condition | Required Dependency |
|-----------|-------------------|
| Vitest + React | `jsdom` or `happy-dom` |
| Any React project | `@testing-library/react` |

**Logic**:
1. Read `package.json`
2. Check `dependencies` and `devDependencies`
3. Return list of missing packages

**If Missing**: Skip validation, generate test without running it, set error message

**Code**: `githubWorkflow.ts:463-492`

---

### Step 8: Generate and Validate Tests

**Code Location**: `githubWorkflow.ts:144-180`

Two paths depending on whether validation should run:

#### Path A: Full Validation (deps present)

**Module**: `src/core/testValidator.ts`

```typescript
validationResult = await validateAndFixTest({
  apiKey, model, provider, baseUrl,
  userStory: storyText,
  searchResults,
  testDir,
  framework,
  imports,
  workspacePath,
  maxAttempts: 3
});
```

**Process**:
1. **Generate**: Call LLM to create initial test code
2. **Write**: Save test file to temporary location
3. **Run**: Execute test with detected framework
4. **Check**: Did test pass?
   - Yes → Return successful result
   - No → Continue to fix
5. **Fix**: Send error to LLM, ask for corrected code
6. **Repeat**: Up to `maxAttempts` times (default 3)

**Validation Loop**:
```
┌─────────────────────────────────────┐
│  Generate Test Code (LLM)           │
└──────────────┬──────────────────────┘
               │
               v
┌──────────────────────────────────────┐
│  Write to Temp File                  │
└──────────────┬───────────────────────┘
               │
               v
┌──────────────────────────────────────┐
│  Run Test (Jest/Vitest)              │
└──────────────┬───────────────────────┘
               │
        ┌──────┴──────┐
        │             │
    [Pass]        [Fail]
        │             │
        v             v
    Success    ┌──────────────────┐
               │ Send Error to LLM│
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

**Code**: `testValidator.ts:1-123`

#### Path B: Generate Without Validation

**Module**: `src/core/testGenerator.ts`

```typescript
const generated = await generateWithoutValidation({
  apiKey, model, provider, baseUrl,
  userStory: storyText,
  searchResults,
  testDir,
  framework,
  imports
});
```

Calls LLM once to generate test code, no execution or fixing.

**When Used**:
- Framework is `playwright` or `unknown`
- Required dependencies are missing
- Validation explicitly disabled

---

### Step 9: Create or Update Branch

**Code Location**: `githubWorkflow.ts:184-228`

**Module**: `src/integrations/githubClient.ts`

Check if PR already exists for this issue:

```typescript
const existingPr = await client.findExistingPR({ issueNumber: issue.number });
```

**If PR Exists**:
1. Use existing branch name
2. Check if branch exists remotely
3. If missing, recreate from base branch
4. Commit updated test file to branch
5. Refresh head SHA for check runs

**If No PR**:
1. Generate branch name: `test/issue-{number}`
2. Get base branch SHA (try `main`, fallback to `master`)
3. Create new branch
4. Commit test file
5. Create pull request
6. Store PR URL and head SHA

**Branch Naming**: `test/issue-42`

---

### Step 10: Add Label to PR

**Code Location**: `githubWorkflow.ts:246-253`

```typescript
await client.addLabel({ prNumber, label: "tests-generated" });
```

Adds `tests-generated` label to the PR for easy filtering. Logs failure but doesn't block workflow.

---

### Step 11: Create Check Run (Optional)

**Code Location**: `githubWorkflow.ts:256-280`

**Gated by**: `USE_CHECK_RUNS` environment variable (default: `false`)

If enabled and validation passed:
```typescript
await client.createCheckRun({
  name: "StoryToTest",
  headSha: prHeadSha,
  conclusion: "success",
  summary: "Validation passed in 2 attempt(s)",
  details: "..." // Error details if any
});
```

**Why Optional**: GitHub Checks API requires a GitHub App token. When using a Personal Access Token (PAT), this would return 403 errors.

**Enable**: Set `USE_CHECK_RUNS=true` when using GitHub App authentication

---

### Step 12: Comment on Issue

**Code Location**: `githubWorkflow.ts:283-285`

Post a summary comment to the original issue:

**Comment Structure**:
```markdown
Tests have been passed validation and a pull request has been created.

**PR:** https://github.com/owner/repo/pull/123
**Matched:** BlogCardProps (interfaces); BlogService (classes)
**Validation:** ✅ Passed (2 attempt(s))
```

**Includes**:
- Status (passed/skipped/failed)
- PR link
- Matched components
- Validation summary with emoji indicator
- Error snippet (if validation failed)

**Code**: `githubWorkflow.ts:343-374`

---

### Step 13: Build PR Body

**Code Location**: `githubWorkflow.ts:306-341`

Creates detailed PR description:

**Sections**:
1. **Header**: Auto-generated notice
2. **Issue Link**: Link back to original issue
3. **Validation Status**: Pass/fail/skip with emoji
4. **Matched Components**: List of interfaces and classes used
5. **Issue Description**: Full issue body for context

**Example PR Body**:
```markdown
## Auto-generated Tests

This PR was automatically generated from issue #42.

**Issue:** [Add BlogCard tests](https://github.com/owner/repo/issues/42)

**Validation:** ✅ Passed after 2 attempt(s)

### Matched Components

BlogCardProps (interfaces); BlogService (classes)

### Issue Description

As a user, I want to see the BlogCard component with title and description
```

---

## Error Handling

**Code Location**: `githubWorkflow.ts:289-303`

If any step fails:
1. Log error with `[issue #N][error]` prefix
2. Attempt to post error comment to issue
3. Return `{ success: false, error: errorMessage }`

**Error Comment Example**:
```
Test generation failed: Failed to clone workspace repo: Permission denied
```

---

## Logging Format

All workflow steps use structured logging:

```
[issue #42][start] Processing: Add BlogCard tests
[issue #42][detect] workspace: /workspace
[issue #42][detect] framework: vitest
[issue #42][index] Indexing codebase
[issue #42][parse] entities: blogcard, component, title
[issue #42][search] Matched 1 interfaces, 1 classes
[issue #42][generate] Generating and validating tests
[issue #42][validate] passed=true, attempts=2
[issue #42][pr] Creating PR on branch: test/issue-42
[issue #42][label] Adding 'tests-generated' label
[issue #42][check] Skipping check run (PAT or checks disabled)
[issue #42][comment] Posting results to issue
[issue #42][done] Workflow completed successfully
```

**Benefits**:
- Easy to grep logs by issue number
- Clear visibility into which step is executing
- Consistent format across all operations

---

## Configuration Options

**Interface**: `WorkflowConfig` in `githubWorkflow.ts:22-35`

```typescript
interface WorkflowConfig {
  workspaceRoot: string;      // Path to project root
  githubToken: string;        // GitHub authentication token
  githubOwner: string;        // Repository owner
  githubRepo: string;         // Repository name
  llmApiKey: string;          // LLM provider API key
  llmProvider?: LLMProvider;  // "openai" | "anthropic" | "gemini"
  llmModel?: string;          // Model name
  llmBaseUrl?: string;        // Custom API endpoint
  baseBranch?: string;        // Base branch (default: "main")
  maxAttempts?: number;       // Validation attempts (default: 3)
  testOutputDir?: string;     // Test directory (default: "__tests__")
  dryRun?: boolean;           // Skip GitHub API calls
}
```

---

## Related Documentation

- [[00-Overview]] - System architecture and concepts
- [[02-GitHub-Integration]] - GitHub API details
- [[03-Core-Modules]] - Individual module documentation
- [[04-LLM-Integration]] - Language model interaction

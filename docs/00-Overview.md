# StoryToTest - System Overview

## What is StoryToTest?

StoryToTest is an automated test generation system that converts user stories (written in natural language) into executable test code. It analyzes your TypeScript codebase, understands the components and interfaces, and generates tests using AI language models.

## How It Works - High Level

```
User Story (GitHub Issue)
         |
         v
    [Webhook Trigger]
         |
         v
    [Parse Story] --> Extract entities & actions
         |
         v
    [Index Codebase] --> Find all interfaces & classes
         |
         v
    [Search Components] --> Match story entities to code
         |
         v
    [Generate Tests] --> Use LLM to create test code
         |
         v
    [Validate & Fix] --> Run tests, fix errors iteratively
         |
         v
    [Create PR] --> Commit test file, open pull request
```

## Architecture Overview

The system is organized into distinct layers:

```
┌─────────────────────────────────────────────────────────┐
│                    Entry Points                          │
│  - VSCode Extension (src/extension.ts)                   │
│  - Webhook Server (src/integrations/githubWebhook.ts)   │
│  - Serverless Handler (api/webhook/github.ts)           │
└────────────────────┬────────────────────────────────────┘
                     |
┌────────────────────▼────────────────────────────────────┐
│              Workflow Orchestration                      │
│        src/integrations/githubWorkflow.ts                │
│  - processGitHubIssue() - Main workflow function        │
│  - Coordinates all steps from story to PR                │
└────────────────────┬────────────────────────────────────┘
                     |
        ┌────────────┼────────────┐
        |            |            |
┌───────▼──────┐ ┌──▼──────┐ ┌──▼────────────┐
│ Core Modules │ │ GitHub  │ │ LLM Provider  │
│              │ │ Client  │ │               │
│ - Parser     │ │         │ │ - OpenAI      │
│ - Indexer    │ │ - API   │ │ - Anthropic   │
│ - Search     │ │ - Auth  │ │ - Gemini      │
│ - Generator  │ │ - PRs   │ │               │
│ - Validator  │ │ - Check │ │               │
│ - Runner     │ │   Runs  │ │               │
└──────────────┘ └─────────┘ └───────────────┘
```

## Directory Structure

```
storytotest/
├── src/
│   ├── core/                    # Core business logic
│   │   ├── storyParser.ts       # Parse user stories
│   │   ├── codebaseIndexer.ts   # Scan TypeScript files
│   │   ├── componentSearch.ts   # Match entities to code
│   │   ├── testGenerator.ts     # Generate test code via LLM
│   │   ├── testValidator.ts     # Validate and fix tests
│   │   ├── testRunner.ts        # Execute test files
│   │   ├── frameworkDetector.ts # Detect Jest/Vitest/Playwright
│   │   ├── importResolver.ts    # Generate import statements
│   │   └── types.ts             # Shared type definitions
│   │
│   ├── integrations/            # External integrations
│   │   ├── githubWorkflow.ts    # Main workflow orchestration
│   │   ├── githubClient.ts      # GitHub API wrapper
│   │   ├── githubWebhook.ts     # Webhook server
│   │   └── envHelper.ts         # Environment variable parsing
│   │
│   ├── llm/                     # LLM provider abstraction
│   │   ├── provider.ts          # Provider types and defaults
│   │   └── env.ts               # LLM config from environment
│   │
│   └── extension.ts             # VSCode extension entry point
│
├── api/
│   └── webhook/
│       └── github.ts            # Serverless webhook handler
│
└── docs/                        # Documentation (you are here)
```

## Key Concepts

### User Story
A natural language description of desired functionality, typically written as a GitHub issue. Example:
```
As a user, I want to view the "BlogCard" component with a title and description
```

### Entities
Keywords extracted from the user story that likely correspond to code elements (interfaces, classes, components). From the example above: `user`, `view`, `blogcard`, `component`, `title`, `description`

### Codebase Index
A complete catalog of all interfaces and classes in the TypeScript codebase, including:
- Name
- File path
- Properties (for interfaces) or methods (for classes)
- Export status

### Test Framework
The testing library used in the project. Supported frameworks:
- **Jest** - Popular test framework
- **Vitest** - Fast Vite-native test framework
- **Playwright** - End-to-end testing
- **Unknown** - No framework detected (can scaffold Vitest optionally)

### Validation
The process of running generated tests to ensure they compile and execute correctly. If tests fail, the system uses the LLM to fix errors iteratively (up to 3 attempts by default).

## Deployment Modes

### 1. VSCode Extension
Run directly in your IDE. Triggered via command palette.

**File**: `src/extension.ts`

### 2. Webhook Server
Standalone Node.js server that listens for GitHub webhook events.

**File**: `src/integrations/githubWebhook.ts`

**Start**: `ts-node src/integrations/githubWebhook.ts`

### 3. Serverless Function
Deploy to Vercel, Railway, or similar platforms. Automatically clones the target repository.

**File**: `api/webhook/github.ts`

## Data Flow Example

Let's trace a complete flow:

1. **Trigger**: User adds label `ready-for-tests` to GitHub issue #42
2. **Webhook**: GitHub sends POST to your webhook endpoint
3. **Parse**: Extract "BlogCard" and "title" from issue body
4. **Index**: Scan codebase, find `BlogCardProps` interface in `src/components/BlogCard.tsx`
5. **Search**: Match "blogcard" entity to `BlogCardProps` interface
6. **Generate**: LLM creates test file using matched interface
7. **Validate**: Run test with Jest, detect missing import
8. **Fix**: LLM adds missing import, test passes
9. **Commit**: Create branch `test/issue-42`, commit test file
10. **PR**: Open pull request with test code, link to issue #42
11. **Comment**: Post results to issue with PR link and validation status

## Related Documentation

- [[01-Workflow-Process]] - Detailed step-by-step workflow
- [[02-GitHub-Integration]] - GitHub API, webhooks, and authentication
- [[03-Core-Modules]] - Parser, indexer, search, generator, validator
- [[04-LLM-Integration]] - Language model providers and prompts
- [[05-Configuration]] - Environment variables and settings

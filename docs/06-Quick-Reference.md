# Quick Reference Guide

This document provides quick-access diagrams, cheat sheets, and common patterns for working with StoryToTest.

## Complete System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         TRIGGER EVENT                            │
│  - VSCode Command                                                │
│  - GitHub Issue Labeled "ready-for-tests"                        │
│  - Manual API Call                                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│                    ENTRY POINT LAYER                             │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   VSCode     │  │   Webhook    │  │  Serverless  │          │
│  │  Extension   │  │    Server    │  │   Function   │          │
│  │              │  │              │  │              │          │
│  │ extension.ts │  │ webhook.ts   │  │ github.ts    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┼──────────────────┘                  │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             v
┌─────────────────────────────────────────────────────────────────┐
│              WORKFLOW ORCHESTRATION LAYER                        │
│                                                                   │
│              processGitHubIssue(issue, config)                   │
│                  githubWorkflow.ts                               │
│                                                                   │
│  [start] → [detect] → [index] → [parse] → [search] →            │
│  [generate] → [validate] → [pr] → [label] → [check] →           │
│  [comment] → [done]                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        v                    v                    v
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│ CORE MODULES │  │ GITHUB CLIENT    │  │ LLM PROVIDER │
│              │  │                  │  │              │
│ Parser       │  │ Branches         │  │ OpenAI       │
│ Indexer      │  │ Commits          │  │ Anthropic    │
│ Search       │  │ PRs              │  │ Gemini       │
│ Generator    │  │ Comments         │  │              │
│ Validator    │  │ Labels           │  │ Custom       │
│ Runner       │  │ Check Runs       │  │              │
│ Detector     │  │                  │  │              │
└──────────────┘  └──────────────────┘  └──────────────┘
```

## Data Flow Through System

```
GitHub Issue
    |
    | {number, title, body, html_url}
    v
Story Parser
    |
    | {rawText, entities[], actions[]}
    v
Codebase Indexer
    |
    | {interfaces[], classes[]}
    v
Component Search
    |
    | {matchedInterfaces[], matchedClasses[]}
    v
Import Resolver
    |
    | ["import { X } from 'Y'", ...]
    v
Test Generator (LLM)
    |
    | {code, fileName}
    v
Test Validator (Loop)
    |
    | {code, fileName, attempts, passed, lastError}
    v
GitHub Client
    |
    | {prUrl, prNumber, headSha}
    v
Issue Comment
    |
    | Success/Failure notification
    v
Complete
```

## File Organization Map

```
storytotest/
│
├── src/
│   ├── core/                          [Business Logic]
│   │   ├── storyParser.ts             Extract keywords from stories
│   │   ├── codebaseIndexer.ts         Scan TypeScript files
│   │   ├── componentSearch.ts         Match entities to code
│   │   ├── testGenerator.ts           Generate tests via LLM
│   │   ├── testValidator.ts           Validate and fix tests
│   │   ├── testRunner.ts              Execute test files
│   │   ├── frameworkDetector.ts       Detect Jest/Vitest/Playwright
│   │   ├── importResolver.ts          Generate import statements
│   │   └── types.ts                   TypeScript interfaces
│   │
│   ├── integrations/                  [External Systems]
│   │   ├── githubWorkflow.ts          Main orchestrator
│   │   ├── githubClient.ts            GitHub API wrapper
│   │   ├── githubWebhook.ts           Webhook server
│   │   └── envHelper.ts               Environment parsing
│   │
│   ├── llm/                           [AI Integration]
│   │   ├── provider.ts                Provider types
│   │   └── env.ts                     LLM configuration
│   │
│   └── extension.ts                   [VSCode Entry]
│
├── api/
│   └── webhook/
│       └── github.ts                  [Serverless Entry]
│
└── docs/                              [Documentation]
    ├── 00-Overview.md                 System architecture
    ├── 01-Workflow-Process.md         Step-by-step flow
    ├── 02-GitHub-Integration.md       GitHub API details
    ├── 03-Core-Modules.md             Module documentation
    ├── 04-LLM-Integration.md          AI provider details
    ├── 05-Configuration.md            Environment variables
    └── 06-Quick-Reference.md          This file
```

## Common Workflows

### Workflow 1: Manual Test Generation (VSCode)

```
1. Open project in VSCode
2. Open Command Palette (Cmd/Ctrl + Shift + P)
3. Type "StoryToTest: Generate Tests"
4. Paste user story when prompted
5. Wait for test generation
6. Review generated test file
7. Commit to repository
```

### Workflow 2: Automated via Webhook

```
1. User creates GitHub issue with story
2. User adds label "ready-for-tests"
3. GitHub sends webhook to your server
4. Server verifies signature
5. Server calls processGitHubIssue()
6. System generates and validates tests
7. System creates PR with tests
8. System comments on issue with PR link
9. User reviews PR and merges
```

### Workflow 3: Serverless Deployment

```
1. Set environment variables in Vercel/Railway
2. Deploy application
3. Configure GitHub webhook with deployment URL
4. Label issue to trigger
5. Serverless function:
   - Clones repository to /tmp/workspace
   - Generates tests
   - Creates PR
   - Returns 202 Accepted
6. Background processing completes
7. PR appears in repository
```

## Environment Variable Cheat Sheet

### Minimal Configuration

```bash
# Required
WORKSPACE_ROOT=/path/to/project
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=username
GITHUB_REPO=repository
LLM_API_KEY=sk-proj-...
```

### Full Configuration

```bash
# GitHub
WORKSPACE_ROOT=/path/to/project
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=username
GITHUB_REPO=repository
BASE_BRANCH=main

# LLM
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-...
LLM_MODEL=gpt-4-turbo
LLM_BASE_URL=https://api.openai.com/v1

# Workflow
MAX_ATTEMPTS=3
TEST_OUTPUT_DIR=__tests__
DRY_RUN=false

# Features
USE_CHECK_RUNS=false
ALLOW_SCAFFOLD_VITEST=false

# Webhook
PORT=3000
WEBHOOK_SECRET=secret
TRIGGER_LABEL=ready-for-tests
```

## Command Reference

### Start Webhook Server

```bash
# Development
ts-node src/integrations/githubWebhook.ts

# Production with PM2
pm2 start src/integrations/githubWebhook.ts --interpreter ts-node

# With custom port
PORT=8080 ts-node src/integrations/githubWebhook.ts
```

### Deploy Serverless

```bash
# Vercel
vercel deploy

# Railway
railway up

# Check deployment
curl -X POST https://your-app.vercel.app/api/webhook/github \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'
```

### Test Locally

```bash
# Compile TypeScript
npm run compile

# Run tests
npm test

# Lint code
npm run lint

# Watch mode
npm run watch
```

## API Response Formats

### Success Response

```typescript
{
  success: true,
  prUrl: "https://github.com/owner/repo/pull/123"
}
```

### Error Response

```typescript
{
  success: false,
  error: "Failed to clone workspace repo: Permission denied"
}
```

### Validation Result

```typescript
{
  code: "import { test } from...",
  fileName: "BlogCard.test.ts",
  attempts: 2,
  passed: true,
  lastError: null,
  skipped: false,
  framework: "vitest"
}
```

## Common Error Messages and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing required environment variable: X" | Variable not set | `export X=value` |
| "Invalid API key" | Wrong LLM key | Check key format and provider |
| "403 Forbidden" | GitHub permissions | Check token scopes or disable check runs |
| "No matching components found" | Story doesn't match code | Use specific keywords or quotes |
| "Validation failed after 3 attempts" | Test errors persist | Check dependencies, framework config |
| "Failed to clone workspace repo" | Repository access | Verify token has repo access |
| "Webhook signature verification failed" | Wrong secret | Match WEBHOOK_SECRET with GitHub |

## Logging Format Reference

All workflow logs follow this pattern:

```
[issue #<number>][<step>] <message>
```

**Steps**:
- `start` - Workflow begins
- `detect` - Framework detection
- `index` - Codebase scanning
- `parse` - Story parsing
- `search` - Component matching
- `generate` - Test generation
- `validate` - Test validation
- `pr` - Pull request creation
- `label` - Label addition
- `check` - Check run creation
- `comment` - Issue comment
- `done` - Workflow complete
- `error` - Error occurred
- `scaffold` - Vitest scaffolding
- `workspace` - Workspace setup (serverless)

**Example Log Sequence**:
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

## Test Framework Detection Logic

```
Check package.json dependencies
    |
    ├─ Has "@playwright/test"? → playwright
    ├─ Has "vitest"? → vitest
    ├─ Has "jest"? → jest
    └─ None found? → unknown
         |
         └─ ALLOW_SCAFFOLD_VITEST=true?
              ├─ Yes → Create vitest.config.ts → vitest
              └─ No → Stay unknown (skip validation)
```

## Validation Loop Flowchart

```
Generate Test (Attempt 1)
    |
    v
Write to Temp File
    |
    v
Run Test
    |
    v
Test Passed?
    |
    ├─ Yes → Return Success
    |
    └─ No → Extract Error
         |
         v
    Attempt < Max (3)?
         |
         ├─ Yes → Send Error to LLM
         |         |
         |         v
         |    Generate Fix
         |         |
         |         └─ (Loop back to Write)
         |
         └─ No → Return Failed
```

## GitHub Webhook Payload Structure

```json
{
  "action": "labeled",
  "issue": {
    "number": 42,
    "title": "Add BlogCard tests",
    "body": "As a user, I want to...",
    "html_url": "https://github.com/owner/repo/issues/42"
  },
  "label": {
    "name": "ready-for-tests"
  },
  "repository": {
    "name": "repository",
    "owner": {
      "login": "username"
    }
  }
}
```

## LLM Provider Comparison

| Feature | OpenAI | Anthropic | Gemini |
|---------|--------|-----------|--------|
| Cost (per 1M tokens) | $10-30 | $3-15 | $0.01-0.05 |
| Context Window | 128K | 200K | 1M |
| Code Quality | Excellent | Very Good | Good |
| Speed | Fast | Fast | Very Fast |
| Best For | Quality | Balance | Volume |

## File Naming Conventions

Generated test files follow these patterns:

| Framework | Pattern | Example |
|-----------|---------|---------|
| Jest | `*.test.ts` | `BlogCard.test.ts` |
| Vitest | `*.test.ts` | `BlogCard.test.ts` |
| Playwright | `*.spec.ts` | `BlogCard.spec.ts` |

## Import Statement Patterns

**Named Export**:
```typescript
import { BlogCardProps } from "../src/components/BlogCard";
```

**Default Export**:
```typescript
import BlogCard from "../src/components/BlogCard";
```

**Multiple Named Exports**:
```typescript
import { BlogCardProps, BlogService } from "../src/blog";
```

## PR Body Template

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

## Issue Comment Template

```markdown
Tests have been passed validation and a pull request has been created.

**PR:** https://github.com/owner/repo/pull/123
**Matched:** BlogCardProps (interfaces); BlogService (classes)
**Validation:** ✅ Passed (2 attempt(s))
```

## Troubleshooting Decision Tree

```
Issue Occurred
    |
    v
Is it a GitHub error?
    |
    ├─ Yes → Check token permissions
    |         Check rate limits
    |         Verify owner/repo names
    |
    └─ No → Is it an LLM error?
         |
         ├─ Yes → Verify API key
         |         Check provider/model
         |         Test with curl
         |
         └─ No → Is it a validation error?
              |
              ├─ Yes → Check dependencies
              |         Verify framework config
              |         Review test errors
              |
              └─ No → Is it a webhook error?
                   |
                   ├─ Yes → Verify signature
                   |         Check payload format
                   |         Review server logs
                   |
                   └─ No → Check general logs
                            Review configuration
                            Test in dry-run mode
```

## Performance Benchmarks

Typical execution times:

| Operation | Time | Notes |
|-----------|------|-------|
| Story Parsing | <100ms | Regex-based, very fast |
| Codebase Indexing | 1-10s | Depends on project size |
| Component Search | <100ms | Simple string matching |
| LLM Generation | 5-30s | Varies by provider/model |
| Test Validation | 2-10s | Depends on test complexity |
| GitHub API Calls | 1-5s | Network-dependent |
| **Total Workflow** | **10-60s** | Typical range |

## Security Checklist

- [ ] API keys stored in environment variables
- [ ] GitHub token has minimal required scopes
- [ ] Webhook secret is strong (32+ characters)
- [ ] Webhook signature verification enabled
- [ ] No sensitive data in logs
- [ ] Rate limiting configured
- [ ] HTTPS used for webhook endpoints
- [ ] Keys rotated regularly
- [ ] Separate keys for dev/prod

## Related Documentation

- [[00-Overview]] - Start here for system understanding
- [[01-Workflow-Process]] - Detailed step-by-step process
- [[02-GitHub-Integration]] - GitHub API and webhooks
- [[03-Core-Modules]] - Individual module details
- [[04-LLM-Integration]] - AI provider configuration
- [[05-Configuration]] - Complete environment reference

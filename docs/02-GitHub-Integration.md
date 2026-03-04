# GitHub Integration

This document covers how StoryToTest integrates with GitHub, including webhooks, API interactions, authentication, and deployment modes.

## GitHub Client

**Location**: `src/integrations/githubClient.ts`

Wrapper around the Octokit REST API that provides high-level methods for all GitHub operations.

### Initialization

```typescript
const client = new GitHubClient({
  token: config.githubToken,
  owner: config.githubOwner,
  repo: config.githubRepo,
  dryRun: config.dryRun
});
```

**Parameters**:
- `token`: GitHub authentication token (PAT or App token)
- `owner`: Repository owner (user or organization)
- `repo`: Repository name
- `dryRun`: If true, logs operations without executing them

### Core Operations

#### 1. Branch Management

**Get Default Branch SHA**:
```typescript
const sha = await client.getDefaultBranchSHA("main");
```
Retrieves the latest commit SHA for a branch.

**Create Branch**:
```typescript
await client.createBranch("test/issue-42", baseSHA);
```
Creates a new branch reference pointing to the specified commit.

**Find Branch**:
```typescript
const exists = await client.findBranch("test/issue-42");
```
Checks if a branch exists remotely.

**Get Branch Head SHA**:
```typescript
const sha = await client.getBranchHeadSHA("test/issue-42");
```
Gets the current HEAD commit SHA of a branch.

#### 2. File Operations

**Commit File**:
```typescript
await client.commitFile(
  "test/issue-42",           // branch
  "__tests__/BlogCard.test.ts", // path
  testCode,                  // content
  "Add BlogCard tests"       // message
);
```

**Process**:
1. Get current tree SHA of branch
2. Create blob with file content
3. Create new tree with blob
4. Create commit pointing to new tree
5. Update branch reference

**Handles**: Creating new files or updating existing ones

#### 3. Pull Request Management

**Create Test PR**:
```typescript
const pr = await client.createTestPR({
  issueNumber: 42,
  branchName: "test/issue-42",
  filePath: "__tests__/BlogCard.test.ts",
  fileContent: testCode,
  prTitle: "Tests for issue #42: Add BlogCard tests",
  prBody: "## Auto-generated Tests\n...",
  baseBranch: "main"
});
```

**Returns**:
```typescript
{
  url: "https://github.com/owner/repo/pull/123",
  number: 123,
  headSha: "abc123..."
}
```

**Find Existing PR**:
```typescript
const existingPr = await client.findExistingPR({ issueNumber: 42 });
```

Searches for open PRs with branch name matching `test/issue-{number}` pattern.

**Returns**:
```typescript
{
  url: "https://github.com/owner/repo/pull/123",
  number: 123,
  headRef: "test/issue-42",
  headSha: "abc123..."
} | null
```

#### 4. Issue Comments

**Comment on Issue**:
```typescript
await client.commentOnIssue(42, "Tests have been generated!\n\n**PR:** ...");
```

Posts a comment to the specified issue number.

#### 5. Labels

**Add Label to PR**:
```typescript
await client.addLabel({ prNumber: 123, label: "tests-generated" });
```

Adds a label to a pull request for categorization.

#### 6. Check Runs

**Create Check Run**:
```typescript
await client.createCheckRun({
  name: "StoryToTest",
  headSha: "abc123...",
  conclusion: "success",
  summary: "Validation passed in 2 attempt(s)",
  details: "Error details if any..."
});
```

**Requires**: GitHub App token (not available with PAT)

**Conclusion Values**: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`

---

## Webhook Integration

StoryToTest can be triggered automatically when GitHub issues are labeled.

### Webhook Server Mode

**Location**: `src/integrations/githubWebhook.ts`

Standalone Node.js HTTP server that listens for GitHub webhook events.

**Start Server**:
```bash
ts-node src/integrations/githubWebhook.ts
```

**Configuration**:
```bash
PORT=3000
WEBHOOK_SECRET=your-webhook-secret
TRIGGER_LABEL=ready-for-tests
WORKSPACE_ROOT=/path/to/project
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=username
GITHUB_REPO=repository
LLM_API_KEY=sk-...
```

**Process Flow**:
```
GitHub Issue Labeled
       |
       v
[Webhook POST Request]
       |
       v
[Verify Signature] --> HMAC SHA-256 validation
       |
       v
[Parse Payload] --> Extract action, label, issue
       |
       v
[Check Trigger] --> Is action "labeled" and label "ready-for-tests"?
       |
       v
[Process Issue] --> Call processGitHubIssue()
       |
       v
[Return 200 OK]
```

**Signature Verification**:
```typescript
function verifySignature(secret, body, signature) {
  const expectedSignature = 
    "sha256=" + crypto.createHmac("sha256", secret)
                      .update(body)
                      .digest("hex");
  return safeEqual(expectedSignature, signature);
}
```

Uses timing-safe comparison to prevent timing attacks.

**Trigger Conditions**:
- Event type: `issues`
- Action: `labeled`
- Label name: Matches `TRIGGER_LABEL` (default: `ready-for-tests`)

**Alternative Triggers**:
You can also trigger on:
- `opened` - When issue is created
- `edited` - When issue is updated
- Custom labels - Set `TRIGGER_LABEL` to your preferred label

### Serverless Mode

**Location**: `api/webhook/github.ts`

Designed for serverless platforms like Vercel, Railway, Netlify.

**Key Differences from Server Mode**:

1. **Auto-Clone Workspace**: Automatically clones the target repository if workspace is empty

```typescript
function ensureWorkspace(workspacePath, owner, repo, token, issueNumber) {
  // Check if workspace exists and has content
  if (fs.existsSync(workspacePath)) {
    const entries = fs.readdirSync(workspacePath);
    if (entries.length > 0) {
      return; // Already populated
    }
  }
  
  // Clone repository (shallow, depth 1)
  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  execSync(`git clone --depth 1 ${cloneUrl} ${workspacePath}`, {
    stdio: "pipe",
    timeout: 120_000 // 2 minutes
  });
}
```

**Clone Details**:
- Shallow clone (depth 1) for speed
- Uses GitHub token for authentication
- Idempotent - skips if already cloned
- 2-minute timeout
- Logs with issue prefix

2. **Async Processing**: Uses `waitUntil` for background processing

```typescript
const waitUntil = resolveWaitUntil(); // Vercel's waitUntil helper

if (waitUntil) {
  waitUntil(processGitHubIssue(issue, config));
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Accepted" }));
} else {
  // Fallback: process inline
  const result = await processGitHubIssue(issue, config);
  res.writeHead(result.success ? 200 : 500);
  res.end(JSON.stringify(result));
}
```

**Benefits**:
- Returns 202 Accepted immediately
- Processing continues in background
- Avoids webhook timeout issues

3. **Default Workspace**: Uses `/tmp/workspace` if not specified

**Deployment**:

For Vercel:
```bash
vercel deploy
```

For Railway:
```bash
railway up
```

**Environment Variables**: Same as webhook server mode, plus:
- `WORKSPACE_ROOT` defaults to `/tmp/workspace`

---

## Authentication

### Personal Access Token (PAT)

**Scopes Required**:
- `repo` - Full repository access
- `write:discussion` - Comment on issues/PRs

**Limitations**:
- Cannot create check runs (403 error)
- Set `USE_CHECK_RUNS=false` to disable check runs

**Generate**: GitHub Settings → Developer settings → Personal access tokens → Generate new token

### GitHub App Token

**Benefits**:
- Can create check runs
- More granular permissions
- Better rate limits

**Permissions Required**:
- Repository contents: Read & write
- Issues: Read & write
- Pull requests: Read & write
- Checks: Read & write (for check runs)

**Setup**:
1. Create GitHub App
2. Install on repository
3. Generate private key
4. Use App ID + private key to generate installation tokens

**Enable Check Runs**: Set `USE_CHECK_RUNS=true`

---

## Webhook Setup on GitHub

### 1. Navigate to Repository Settings

Go to: `https://github.com/{owner}/{repo}/settings/hooks`

### 2. Add Webhook

Click "Add webhook"

### 3. Configure Webhook

**Payload URL**: Your webhook endpoint
- Server mode: `https://your-domain.com:3000/webhook`
- Serverless: `https://your-app.vercel.app/api/webhook/github`

**Content type**: `application/json`

**Secret**: Your webhook secret (matches `WEBHOOK_SECRET` env var)

**Events**: Select "Let me select individual events"
- Check: `Issues`

**Active**: Checked

### 4. Test Webhook

1. Create a test issue
2. Add label `ready-for-tests`
3. Check webhook delivery in GitHub settings
4. Check your server logs

---

## Dry Run Mode

**Purpose**: Test workflow without making actual GitHub API calls

**Enable**: Set `dryRun: true` in config

**Behavior**:
- Logs all operations instead of executing
- Skips: branch creation, commits, PR creation, comments, labels, check runs
- Still performs: story parsing, codebase indexing, component search, test generation

**Example Log**:
```
[DRY RUN] Would create branch: test/issue-42
[DRY RUN] Would commit file: __tests__/BlogCard.test.ts
[DRY RUN] Would create PR: Tests for issue #42
[DRY RUN] Would comment on issue #42
```

**Use Cases**:
- Testing workflow logic
- Validating test generation
- Debugging without side effects

---

## Rate Limiting

GitHub API has rate limits:

**Authenticated Requests**:
- PAT: 5,000 requests/hour
- GitHub App: 15,000 requests/hour

**Check Rate Limit**:
```typescript
const { data } = await octokit.rest.rateLimit.get();
console.log(data.rate.remaining); // Requests remaining
console.log(data.rate.reset);     // Reset timestamp
```

**Best Practices**:
- Use conditional requests with ETags
- Cache responses when possible
- Batch operations
- Use GraphQL API for complex queries (not currently implemented)

---

## Error Handling

### Common Errors

**403 Forbidden**:
- Insufficient token permissions
- Check runs with PAT (use `USE_CHECK_RUNS=false`)
- Rate limit exceeded

**404 Not Found**:
- Repository doesn't exist
- Branch doesn't exist
- Wrong owner/repo name

**422 Unprocessable Entity**:
- Invalid branch name
- Commit to protected branch
- PR already exists

**Webhook Signature Mismatch**:
- Wrong `WEBHOOK_SECRET`
- Body modified in transit
- Replay attack

### Error Recovery

**Workflow Level**: `githubWorkflow.ts:289-303`
```typescript
try {
  // Workflow steps
} catch (err) {
  log("error", `Workflow failed: ${err.message}`);
  await client.commentOnIssue(issue.number, `Test generation failed: ${err.message}`);
  return { success: false, error: err.message };
}
```

**Client Level**: Each method has try-catch with specific error handling

---

## Environment Helper

**Location**: `src/integrations/envHelper.ts`

Centralized environment variable parsing with type safety.

**Functions**:

```typescript
// Required string (throws if missing)
const token = requireEnv("GITHUB_TOKEN");

// Optional string with default
const workspace = envString("WORKSPACE_ROOT", "/tmp/workspace");

// Boolean with default
const dryRun = envBool("DRY_RUN", false);

// Integer with default
const port = envInt("PORT", 3000);
```

**Benefits**:
- Type safety
- Consistent parsing
- Clear error messages
- Default value handling

---

## Related Documentation

- [[00-Overview]] - System architecture
- [[01-Workflow-Process]] - Complete workflow steps
- [[05-Configuration]] - Environment variables reference

# Configuration and Environment Variables

This document provides a complete reference for all configuration options and environment variables used in StoryToTest.

## Environment Variables Reference

### Required Variables

These must be set for the system to function:

| Variable | Description | Example |
|----------|-------------|---------|
| `WORKSPACE_ROOT` | Absolute path to project root | `/Users/you/projects/myapp` |
| `GITHUB_TOKEN` | GitHub authentication token | `ghp_xxxxxxxxxxxx` |
| `GITHUB_OWNER` | Repository owner (user/org) | `username` |
| `GITHUB_REPO` | Repository name | `my-repository` |
| `LLM_API_KEY` | LLM provider API key | `sk-proj-xxxxxxxxxxxx` |

### Optional LLM Variables

Configure which LLM provider and model to use:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | Provider: `openai`, `anthropic`, `gemini` |
| `LLM_MODEL` | Provider default | Model name override |
| `LLM_BASE_URL` | Provider default | Custom API endpoint |

**Provider-Specific Variables**:

```bash
# OpenAI
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1

# Gemini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

### Optional Workflow Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_BRANCH` | `main` | Base branch for PRs |
| `MAX_ATTEMPTS` | `3` | Max validation retry attempts |
| `TEST_OUTPUT_DIR` | `__tests__` | Directory for generated tests |
| `DRY_RUN` | `false` | Skip GitHub API calls |

### Optional Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_CHECK_RUNS` | `false` | Enable GitHub check runs (requires App token) |
| `ALLOW_SCAFFOLD_VITEST` | `false` | Auto-scaffold Vitest config when no framework detected |

### Webhook-Specific Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Webhook server port |
| `WEBHOOK_SECRET` | (none) | GitHub webhook secret for signature verification |
| `TRIGGER_LABEL` | `ready-for-tests` | Label that triggers test generation |

## Configuration Files

### VSCode Extension Settings

**Location**: `.vscode/settings.json` or user settings

```json
{
  "storytotest.apiKey": "sk-proj-...",
  "storytotest.provider": "openai",
  "storytotest.model": "gpt-4-turbo",
  "storytotest.baseUrl": ""
}
```

**Legacy Setting**:
```json
{
  "storytotest.openaiApiKey": "sk-proj-..."
}
```
Still supported for backward compatibility.

### Environment File Examples

#### Development (.env)

```bash
# GitHub Configuration
WORKSPACE_ROOT=/Users/you/projects/myapp
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=username
GITHUB_REPO=my-repository

# LLM Configuration
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx
LLM_MODEL=gpt-4-turbo

# Workflow Options
BASE_BRANCH=main
MAX_ATTEMPTS=3
TEST_OUTPUT_DIR=__tests__
DRY_RUN=false

# Feature Flags
USE_CHECK_RUNS=false
ALLOW_SCAFFOLD_VITEST=false

# Webhook Server
PORT=3000
WEBHOOK_SECRET=your-webhook-secret
TRIGGER_LABEL=ready-for-tests
```

#### Production (Serverless)

```bash
# GitHub Configuration
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=username
GITHUB_REPO=my-repository
WORKSPACE_ROOT=/tmp/workspace

# LLM Configuration
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# Workflow Options
MAX_ATTEMPTS=3
USE_CHECK_RUNS=false

# Webhook
WEBHOOK_SECRET=your-webhook-secret
```

#### Local Development with Ollama

```bash
# GitHub Configuration
WORKSPACE_ROOT=/Users/you/projects/myapp
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=username
GITHUB_REPO=my-repository

# LLM Configuration (Local)
LLM_PROVIDER=openai
LLM_API_KEY=dummy-key
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=codellama

# Workflow Options
DRY_RUN=true  # Test locally without GitHub API calls
```

## Configuration Scenarios

### Scenario 1: VSCode Extension

**Use Case**: Run test generation directly in your IDE

**Configuration**:
- Set API key in VSCode settings
- No webhook configuration needed
- Uses current workspace as `WORKSPACE_ROOT`

**Setup**:
1. Install extension
2. Open Command Palette (Cmd/Ctrl + Shift + P)
3. Run "StoryToTest: Generate Tests from User Stories"
4. Enter API key when prompted

### Scenario 2: Webhook Server (Self-Hosted)

**Use Case**: Automated test generation on your own server

**Configuration**:
```bash
# .env
WORKSPACE_ROOT=/var/www/myapp
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=myorg
GITHUB_REPO=myapp
LLM_API_KEY=sk-proj-...
PORT=3000
WEBHOOK_SECRET=random-secret-string
```

**Start Server**:
```bash
ts-node src/integrations/githubWebhook.ts
```

**GitHub Webhook**:
- URL: `https://your-server.com:3000/webhook`
- Secret: Same as `WEBHOOK_SECRET`
- Events: Issues

### Scenario 3: Serverless (Vercel)

**Use Case**: Zero-maintenance deployment

**Configuration** (Vercel Environment Variables):
```
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=myorg
GITHUB_REPO=myapp
LLM_API_KEY=sk-proj-...
WEBHOOK_SECRET=random-secret-string
```

**Deploy**:
```bash
vercel deploy
```

**GitHub Webhook**:
- URL: `https://your-app.vercel.app/api/webhook/github`
- Secret: Same as `WEBHOOK_SECRET`
- Events: Issues

**Note**: `WORKSPACE_ROOT` defaults to `/tmp/workspace` and repository is auto-cloned.

### Scenario 4: Multiple Repositories

**Use Case**: One webhook server handles multiple repos

**Approach 1: Multiple Instances**
Run separate webhook servers with different ports and configurations.

**Approach 2: Dynamic Configuration** (Not currently implemented)
Would require code changes to read owner/repo from webhook payload.

**Current Limitation**: One deployment = one repository

### Scenario 5: Testing Without GitHub

**Use Case**: Test LLM and validation locally

**Configuration**:
```bash
WORKSPACE_ROOT=/Users/you/projects/myapp
GITHUB_TOKEN=dummy-token
GITHUB_OWNER=dummy
GITHUB_REPO=dummy
LLM_API_KEY=sk-proj-...
DRY_RUN=true
```

**Usage**:
- Run workflow programmatically
- All GitHub API calls are logged but not executed
- Test generation and validation still work

## Environment Helper Functions

**Location**: `src/integrations/envHelper.ts`

### requireEnv(name)

Reads required environment variable, throws if missing.

```typescript
const token = requireEnv("GITHUB_TOKEN");
// Throws: "Missing required environment variable: GITHUB_TOKEN"
```

### envString(name, default)

Reads optional string with default value.

```typescript
const workspace = envString("WORKSPACE_ROOT", "/tmp/workspace");
// Returns: value or "/tmp/workspace"
```

### envBool(name, default)

Parses boolean from string.

```typescript
const dryRun = envBool("DRY_RUN", false);
// "true" or "1" → true
// "false" or "0" → false
// empty/missing → default
```

### envInt(name, default)

Parses integer from string.

```typescript
const port = envInt("PORT", 3000);
// "8080" → 8080
// invalid/missing → default
```

## Default Values Summary

| Setting | Default Value | Fallback Logic |
|---------|--------------|----------------|
| LLM Provider | `openai` | First available API key |
| LLM Model | Provider-specific | `gpt-4-turbo`, `claude-3-5-sonnet-latest`, `gemini-2.0-flash` |
| Base Branch | `main` | Try `master` if `main` fails |
| Max Attempts | `3` | Hard-coded in workflow |
| Test Output Dir | `__tests__` | Normalized, sanitized |
| Workspace Root | `/tmp/workspace` | Serverless only |
| Port | `3000` | Webhook server only |
| Trigger Label | `ready-for-tests` | Webhook only |
| Use Check Runs | `false` | Requires GitHub App token |
| Allow Scaffold | `false` | Creates Vitest config |
| Dry Run | `false` | Logs instead of executing |

## Security Best Practices

### 1. API Key Management

**Do**:
- Use environment variables
- Rotate keys regularly
- Use separate keys for dev/prod
- Restrict key permissions

**Don't**:
- Commit keys to git
- Share keys in chat/email
- Use same key across projects
- Log keys in output

### 2. GitHub Token Permissions

**Minimum Required**:
- `repo` scope (or fine-grained: Contents R/W, Issues R/W, PRs R/W)

**Optional**:
- `write:discussion` for check runs (GitHub App only)

**Avoid**:
- Admin permissions
- Organization-wide tokens
- Tokens with unnecessary scopes

### 3. Webhook Secret

**Generate Strong Secret**:
```bash
openssl rand -hex 32
```

**Verify Signatures**:
Always validate webhook signatures to prevent:
- Unauthorized requests
- Replay attacks
- Payload tampering

### 4. Serverless Security

**Considerations**:
- Environment variables are encrypted at rest
- Logs may contain sensitive data
- Function URLs are public (use webhook secret)
- Rate limit to prevent abuse

## Troubleshooting

### Issue: "Missing required environment variable"

**Cause**: Required variable not set

**Solution**:
```bash
# Check current environment
env | grep GITHUB
env | grep LLM

# Set missing variables
export GITHUB_TOKEN=ghp_...
export LLM_API_KEY=sk-proj-...
```

### Issue: "Invalid API key"

**Cause**: Wrong or expired LLM API key

**Solution**:
1. Verify key format (starts with `sk-proj-`, `sk-ant-`, etc.)
2. Check key is active in provider dashboard
3. Ensure correct provider is set
4. Test key with curl:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $LLM_API_KEY"
```

### Issue: "403 Forbidden" from GitHub

**Cause**: Insufficient token permissions or check runs with PAT

**Solution**:
1. Check token scopes in GitHub settings
2. If using PAT, set `USE_CHECK_RUNS=false`
3. Consider using GitHub App token for check runs

### Issue: "Webhook signature verification failed"

**Cause**: Wrong webhook secret or body modification

**Solution**:
1. Verify `WEBHOOK_SECRET` matches GitHub webhook settings
2. Check webhook delivery logs in GitHub
3. Ensure body is not modified by proxy/middleware
4. Test with curl:
```bash
# Generate signature
echo -n "payload" | openssl dgst -sha256 -hmac "secret"
```

### Issue: "No matching components found"

**Cause**: Story entities don't match any code elements

**Solution**:
1. Check story parsing output in logs
2. Verify codebase indexing found interfaces/classes
3. Use more specific keywords in story
4. Put important names in quotes: `"BlogCard"`

### Issue: "Validation failed after 3 attempts"

**Cause**: Generated test has persistent errors

**Solution**:
1. Check `lastError` in workflow result
2. Verify required dependencies are installed
3. Check for missing test framework config
4. Try different LLM model
5. Set `ALLOW_SCAFFOLD_VITEST=true` if no framework detected

### Issue: "Failed to clone workspace repo"

**Cause**: Serverless mode can't access repository

**Solution**:
1. Verify `GITHUB_TOKEN` has repo access
2. Check owner/repo names are correct
3. Ensure repository is not private (or token has access)
4. Check network connectivity
5. Review clone timeout (120s default)

## Configuration Validation

### Pre-Flight Checks

Before running workflow, validate configuration:

```typescript
function validateConfig(config: WorkflowConfig): string[] {
  const errors: string[] = [];
  
  if (!config.workspaceRoot) {
    errors.push("WORKSPACE_ROOT is required");
  }
  
  if (!config.githubToken) {
    errors.push("GITHUB_TOKEN is required");
  }
  
  if (!config.githubOwner) {
    errors.push("GITHUB_OWNER is required");
  }
  
  if (!config.githubRepo) {
    errors.push("GITHUB_REPO is required");
  }
  
  if (!config.llmApiKey) {
    errors.push("LLM_API_KEY is required");
  }
  
  if (!fs.existsSync(config.workspaceRoot)) {
    errors.push(`Workspace does not exist: ${config.workspaceRoot}`);
  }
  
  return errors;
}
```

### Runtime Checks

During workflow execution:
- Verify workspace has TypeScript files
- Check test framework is detected or scaffoldable
- Validate matched components exist
- Confirm test directory is writable

## Related Documentation

- [[00-Overview]] - System architecture
- [[01-Workflow-Process]] - How configuration is used
- [[02-GitHub-Integration]] - GitHub-specific settings
- [[04-LLM-Integration]] - LLM provider details

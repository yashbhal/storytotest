# LLM Integration

This document explains how StoryToTest integrates with language model providers for test generation.

## Supported Providers

StoryToTest supports three LLM providers:

| Provider | Default Model | API Endpoint |
|----------|--------------|--------------|
| OpenAI | `gpt-4-turbo` | `https://api.openai.com/v1` |
| Anthropic | `claude-3-5-sonnet-latest` | `https://api.anthropic.com/v1` |
| Gemini | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |

**Location**: `src/llm/provider.ts`

## Provider Configuration

### Environment-Based Configuration

**Location**: `src/llm/env.ts`

**Function**: `resolveLLMEnvConfig(env)`

Resolves LLM configuration from environment variables with fallback logic.

### Configuration Priority

**Provider Selection**:
1. `LLM_PROVIDER` - Generic provider setting
2. `STORYTOTEST_PROVIDER` - Legacy setting
3. Default: `openai`

**API Key Resolution**:
1. `LLM_API_KEY` - Generic API key
2. Provider-specific keys:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `GEMINI_API_KEY`

**Model Selection**:
1. `LLM_MODEL` - Generic model override
2. Provider-specific models:
   - `OPENAI_MODEL`
   - `ANTHROPIC_MODEL`
   - `GEMINI_MODEL`
3. Default model for provider

**Base URL Override**:
1. `LLM_BASE_URL` - Generic base URL
2. Provider-specific URLs:
   - `OPENAI_BASE_URL`
   - `ANTHROPIC_BASE_URL`
   - `GEMINI_BASE_URL`
3. Default provider endpoint

### Configuration Examples

**Example 1: OpenAI (Default)**
```bash
LLM_API_KEY=sk-proj-...
# Uses: openai, gpt-4-turbo, default endpoint
```

**Example 2: Anthropic**
```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# Uses: anthropic, claude-3-5-sonnet-latest, default endpoint
```

**Example 3: Custom Model**
```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-...
LLM_MODEL=gpt-4o
# Uses: openai, gpt-4o, default endpoint
```

**Example 4: Custom Endpoint (Azure OpenAI)**
```bash
LLM_PROVIDER=openai
LLM_API_KEY=your-azure-key
LLM_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment
LLM_MODEL=gpt-4
```

**Example 5: Local LLM (Ollama)**
```bash
LLM_PROVIDER=openai
LLM_API_KEY=dummy-key
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=codellama
```

## OpenAI SDK Usage

All providers use the OpenAI SDK with custom base URLs:

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseUrl || getDefaultBaseUrl(config.provider)
});

const completion = await openai.chat.completions.create({
  model: config.model,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ],
  temperature: 0.2
});
```

**Why OpenAI SDK for all providers?**
- Anthropic and Gemini support OpenAI-compatible APIs
- Single dependency instead of three
- Consistent interface across providers
- Easy to add new providers

## Prompt Engineering

### System Prompt

**Purpose**: Set the role and constraints for the LLM.

```typescript
const systemPrompt = `You are a test code generator specialized in ${framework} tests.

Your task is to generate high-quality, production-ready test code.

Rules:
1. Use ${framework} syntax and best practices
2. Include all necessary imports at the top
3. Write clear, descriptive test names that explain what is being tested
4. Test all major functionality described in the user story
5. Handle edge cases and error conditions
6. Use proper assertions (expect, toBe, toEqual, etc.)
7. Mock external dependencies appropriately
8. Return ONLY the test code without explanations or markdown
9. Ensure code is properly formatted and indented
10. Use TypeScript types where applicable

Framework-specific guidelines:
${getFrameworkGuidelines(framework)}
`;
```

**Framework Guidelines**:

**Jest**:
```
- Use describe() and it() blocks
- Use jest.fn() for mocks
- Use @testing-library/react for React components
- Use expect() assertions
- Handle async tests with async/await
```

**Vitest**:
```
- Use describe() and it() blocks
- Use vi.fn() for mocks
- Use @testing-library/react for React components
- Use expect() assertions
- Configure test environment in vitest.config.ts
```

**Playwright**:
```
- Use test() and expect() from @playwright/test
- Focus on end-to-end user interactions
- Use page.goto(), page.click(), page.fill()
- Test across different browsers if needed
```

### User Prompt Structure

```typescript
const userPrompt = `
User Story:
${userStory}

Matched Interfaces:
${formatInterfaces(matchedInterfaces)}

Matched Classes:
${formatClasses(matchedClasses)}

Required Imports:
${imports.join('\n')}

Test Directory:
${testDir}

${additionalContext}

Generate a complete, runnable test file that validates the user story.
`;
```

### Interface Formatting

```typescript
function formatInterfaces(interfaces: InterfaceInfo[]): string {
  return interfaces.map(iface => `
interface ${iface.name} {
${iface.properties.map(prop => `  ${prop.name}: ${prop.type};`).join('\n')}
}
File: ${iface.filePath}
Exported: ${iface.isExported}
  `).join('\n---\n');
}
```

### Class Formatting

```typescript
function formatClasses(classes: ClassInfo[]): string {
  return classes.map(cls => `
class ${cls.name} {
  methods: ${cls.methods.join(', ')}
}
File: ${cls.filePath}
Exported: ${cls.isExported}
  `).join('\n---\n');
}
```

## Generation vs Validation Prompts

### Initial Generation

**Context**: First attempt, no errors yet

```typescript
additionalContext = "Generate a passing test that covers the main functionality.";
```

Focus on creating comprehensive, correct tests.

### Validation Without Running

**Context**: Framework doesn't support validation (Playwright, Unknown)

```typescript
additionalContext = "Validation is skipped for this framework. Focus on generating a runnable test file.";
```

Emphasizes correctness since no feedback loop exists.

### Fix Iteration

**Context**: Test failed, need to fix errors

```typescript
const fixPrompt = `
The previous test failed with this error:

${result.error}

Original test code:
\`\`\`typescript
${previousCode}
\`\`\`

Analyze the error and fix the test. Common issues:
- Missing imports
- Incorrect mock setup
- Wrong assertion syntax
- Type errors
- Async handling issues

Return the complete corrected test code.
`;
```

Includes error context and hints for common issues.

## Code Extraction

LLMs may return code in different formats:

**Format 1: Fenced Code Block**
````
```typescript
import { test } from '@playwright/test';
...
```
````

**Format 2: Raw Code**
```
import { test } from '@playwright/test';
...
```

**Extraction Logic**:
```typescript
function extractCode(rawResponse: string): string {
  // Try to extract from fenced code block
  const codeMatch = rawResponse.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)\n```/);
  
  if (codeMatch) {
    return codeMatch[1].trim();
  }
  
  // Fall back to raw response
  return rawResponse.trim();
}
```

## Import Deduplication

LLMs sometimes generate duplicate imports. Clean them up:

```typescript
function deduplicateImports(code: string): string {
  const lines = code.split('\n');
  const importLines = new Set<string>();
  const otherLines: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ')) {
      importLines.add(line); // Preserve original formatting
    } else {
      otherLines.push(line);
    }
  }
  
  // Imports at top, blank line, then rest of code
  return [...Array.from(importLines), '', ...otherLines].join('\n');
}
```

## Temperature Setting

```typescript
temperature: 0.2
```

**Why low temperature?**
- More deterministic output
- Consistent code structure
- Fewer hallucinations
- Better for code generation

**Trade-off**:
- Less creative solutions
- May miss edge cases
- More predictable patterns

For test generation, consistency is more valuable than creativity.

## Token Limits

Typical token usage per generation:

| Component | Tokens |
|-----------|--------|
| System prompt | 200-300 |
| User story | 50-200 |
| Interface definitions | 100-500 |
| Class definitions | 50-200 |
| Imports | 50-100 |
| Additional context | 50-100 |
| **Total Input** | **500-1400** |
| Generated test | 500-2000 |
| **Total** | **1000-3400** |

**Model Context Windows**:
- GPT-4 Turbo: 128K tokens
- Claude 3.5 Sonnet: 200K tokens
- Gemini 2.0 Flash: 1M tokens

All well within limits for typical use cases.

## Error Handling

### API Errors

```typescript
try {
  const completion = await openai.chat.completions.create({...});
} catch (err) {
  if (err.status === 401) {
    throw new Error("Invalid API key");
  } else if (err.status === 429) {
    throw new Error("Rate limit exceeded");
  } else if (err.status === 500) {
    throw new Error("LLM provider error");
  } else {
    throw new Error(`LLM request failed: ${err.message}`);
  }
}
```

### Invalid Responses

If LLM returns non-code content:
```typescript
if (!code.includes('import') && !code.includes('test') && !code.includes('describe')) {
  throw new Error("LLM did not generate valid test code");
}
```

### Timeout Handling

```typescript
const completion = await Promise.race([
  openai.chat.completions.create({...}),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("LLM request timeout")), 60000)
  )
]);
```

## Cost Optimization

### Strategies

1. **Low Temperature**: Reduces retries by generating more consistent code
2. **Targeted Prompts**: Shorter prompts = lower costs
3. **Validation Loop**: Fixes errors instead of regenerating from scratch
4. **Caching**: Could cache common patterns (not currently implemented)

### Cost Estimates (per test generation)

**OpenAI GPT-4 Turbo**:
- Input: 1000 tokens × $0.01/1K = $0.01
- Output: 1500 tokens × $0.03/1K = $0.045
- **Total per test**: ~$0.055

**Anthropic Claude 3.5 Sonnet**:
- Input: 1000 tokens × $0.003/1K = $0.003
- Output: 1500 tokens × $0.015/1K = $0.0225
- **Total per test**: ~$0.026

**Gemini 2.0 Flash**:
- Input: 1000 tokens × $0.00001/1K = $0.00001
- Output: 1500 tokens × $0.00005/1K = $0.000075
- **Total per test**: ~$0.000085

**With Validation (3 attempts)**:
- Multiply by average attempts (typically 1.5-2)
- GPT-4 Turbo: ~$0.08-$0.11 per test
- Claude 3.5 Sonnet: ~$0.04-$0.05 per test
- Gemini 2.0 Flash: ~$0.0001-$0.0002 per test

## Provider-Specific Notes

### OpenAI

**Strengths**:
- Excellent code generation quality
- Strong TypeScript understanding
- Good at following complex instructions

**Considerations**:
- Higher cost than alternatives
- Rate limits on free tier
- Requires API key management

### Anthropic

**Strengths**:
- Good balance of quality and cost
- Large context window
- Strong reasoning capabilities

**Considerations**:
- Slightly different API behavior
- May need prompt adjustments
- Newer provider, less tested

### Gemini

**Strengths**:
- Extremely low cost
- Massive context window
- Fast response times

**Considerations**:
- Code quality may vary
- Less predictable outputs
- Fewer examples in community

## Best Practices

### 1. Provider Selection

Choose based on:
- **Budget**: Gemini for high volume, GPT-4 for quality
- **Quality**: GPT-4 Turbo for complex tests
- **Speed**: Gemini 2.0 Flash for fast iteration

### 2. Model Selection

- Use latest models for best results
- Avoid deprecated models
- Test with your specific use case

### 3. Prompt Engineering

- Be specific about requirements
- Include examples when possible
- Provide context about codebase
- Specify output format clearly

### 4. Error Recovery

- Always validate generated code
- Provide clear error messages to LLM
- Limit retry attempts to avoid cost spiral
- Fall back gracefully on failure

### 5. Security

- Never log API keys
- Use environment variables
- Rotate keys regularly
- Monitor usage for anomalies

## Future Enhancements

Potential improvements:

1. **Prompt Caching**: Cache common prompt components
2. **Fine-tuning**: Train on project-specific patterns
3. **Multi-model**: Try multiple providers, use best result
4. **Streaming**: Stream responses for faster feedback
5. **Context Optimization**: Reduce token usage with smarter prompts
6. **Local Models**: Support for local LLMs (Ollama, LM Studio)

## Related Documentation

- [[00-Overview]] - System architecture
- [[01-Workflow-Process]] - How LLM fits in workflow
- [[03-Core-Modules]] - Test generator and validator
- [[05-Configuration]] - Environment variable reference

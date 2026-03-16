# StoryToTest

Status: In progress and evolving.

Generate tests from a user story by scanning your TypeScript project. The extension indexes interfaces and classes, matches them to story entities, and uses an LLM to write tests. It then runs the tests and retries up to 3 times with errors fed back in. If no framework is detected, you can scaffold Vitest or skip validation.

## Features
- Story to test generation using your codebase types (interfaces/classes) with export awareness
- Framework detection (Jest, Vitest, Playwright detection; validation runs for Jest/Vitest only, Playwright/unknown skip validation)
- Optional Vitest scaffold when no framework is found
- Auto-validation loop: run tests (Jest/Vitest), capture errors, retry up to 3 times (temp files inside `__tests__` for correct relative imports)
- Deterministic framework imports, default vs named import handling, and import deduplication
- Writes tests to `__tests__/` and opens the file

## Demo
![Demo](./the-demo.gif)

## How It Works
1. Indexes your TypeScript files to extract interfaces and classes, tagging whether they are exported and whether they are default exports.
2. Parses the user story to identify entities.
3. Matches story entities to code symbols by simple name matching.
4. Generates a test using the matched types, prefilling imports for exported symbols and instructing the model not to import non-exported types.
5. Runs the test in a validation loop up to 3 times when using Jest/Vitest; temp files live in `__tests__` to keep relative imports correct. Playwright/unknown frameworks skip validation.

## Setup
1. Open a TypeScript workspace (must have `tsconfig.json` or `.ts/.tsx` files).
2. In VS Code settings, set `storytotest.apiKey` (or legacy `storytotest.openaiApiKey`).
3. Optionally set:
   - `storytotest.provider` (`openai`, `anthropic`, `gemini`)
   - `storytotest.model` (provider model name)
   - `storytotest.baseUrl` (optional custom endpoint)
4. Run the command: `StoryToTest: Generate Tests from User Stories`.
5. If no framework is detected, choose to scaffold Vitest (creates `vitest.config.ts` and `test/setupTests.ts`) or skip validation.

## Usage
1. Trigger the command from the Command Palette.
2. Paste a user story, for example: `As a user, I can add items to my shopping cart`.
3. The extension indexes your code, matches types, generates a test, and runs it when Jest/Vitest is detected. Playwright is detected but validation is not implemented; unknown frameworks can skip validation.
4. If tests fail, it retries with the error context. Up to 3 attempts.
5. On success, the test is saved to `__tests__/` and opened.

## Deploy
Deploy the webhook handlers to Vercel. Both the GitHub and Linear webhook handlers run the full test generation pipeline. Deploy your own instance to Vercel with one click.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyashbhal%2Fstorytotest&env=GITHUB_TOKEN,GITHUB_OWNER,GITHUB_REPO,LLM_API_KEY,WEBHOOK_SECRET)

Required environment variables for the webhook:
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
- `LLM_API_KEY` (or provider-specific key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)
- Optional overrides: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` (or provider-specific model/base URL vars), `WORKSPACE_ROOT`, `GITHUB_WEBHOOK_SECRET` (or `WEBHOOK_SECRET`), `DRY_RUN`, `ALLOW_SCAFFOLD_VITEST`, `BASE_BRANCH`, `TEST_OUTPUT_DIR`, `MAX_ATTEMPTS`

### Linear Webhook
The Linear webhook handler lives at `api/webhook/linear.ts` and triggers test generation when a Linear issue transitions to a configured state (default: `Done`).

To wire it up:
1. In your Linear workspace settings, add a webhook pointing to `https://<your-deployment>/api/webhook/linear` for **Issue** events.
2. Copy the signing secret Linear provides and set it as `LINEAR_WEBHOOK_SECRET` in your Vercel environment variables.

Additional Linear-specific env vars:
- `LINEAR_WEBHOOK_SECRET`: HMAC signing secret from the Linear webhook settings page (recommended).
- `LINEAR_TRIGGER_STATE`: Issue state name that triggers test generation (default: `Done`).

## Settings
- `storytotest.apiKey`: API key for the selected provider.
- `storytotest.provider`: LLM provider (`openai`, `anthropic`, `gemini`).
- `storytotest.model`: Model name for the selected provider.
- `storytotest.baseUrl`: Optional base URL override for the provider.
- `storytotest.openaiApiKey`: Legacy key setting kept for backward compatibility.

## Webhook/Automation Env Vars
- `LLM_PROVIDER`: `openai` | `anthropic` | `gemini` (default: `openai`)
- `LLM_API_KEY`: Generic API key for the selected provider
- Provider-specific key fallback:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
- `LLM_MODEL`: Generic model setting (falls back to provider defaults)
- Provider-specific model fallback:
  - `OPENAI_MODEL`
  - `ANTHROPIC_MODEL`
  - `GEMINI_MODEL`
- `LLM_BASE_URL`: Generic base URL override (optional)
- Provider-specific base URL fallback:
  - `OPENAI_BASE_URL`
  - `ANTHROPIC_BASE_URL`
  - `GEMINI_BASE_URL`
- `DRY_RUN`: Set to `true` to enable demo mode (runs full workflow but skips GitHub writes, logs intended actions instead)

## Validation loop
- Supports Jest and Vitest. Playwright and unknown frameworks skip validation with a warning (generation only).
- Commands used:
  - Jest: `npm test -- <file>`
  - Vitest: `npx vitest run <file>`
- Temp test files run inside `__tests__` to keep relative imports correct. Final file is written to `__tests__/` and opened.

## Known limitations
- Validation auto-run only covers Jest and Vitest; Playwright is detected but not executed automatically.
- Story matching is simple (substring matching on entity names); results depend on code naming.
- Complex app setups (providers/routers/data fetching) may need manual instructions in the story.

## License
Apache 2.0 with attribution (see LICENSE).

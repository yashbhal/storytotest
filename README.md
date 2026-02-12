# StoryToTest

Status: In progress and evolving.

Generate tests from a user story by scanning your TypeScript project. The extension indexes interfaces and classes, matches them to story entities, and uses an LLM to write tests. It then runs the tests (Jest or Vitest) and retries up to 3 times with errors fed back in.

## Features
- Story to test generation using your codebase types
- Framework detection (Jest or Vitest) and deterministic imports
- Auto-validation loop: run tests, capture errors, retry up to 3 times
- Writes tests to `__tests__/` and opens the file

## How It Works
1. Indexes your TypeScript files to extract interfaces and classes
2. Parses the user story to identify entities
3. Matches story entities to code symbols by name
4. Generates a test using the matched types
5. Runs the test and retries with error feedback if it fails

## Setup
1. Open a TypeScript workspace (must have `tsconfig.json` or `.ts/.tsx` files).
2. In VS Code settings, set `storytotest.openaiApiKey`.
3. Optionally set `storytotest.model` (default `gpt-4-turbo`).
4. Run the command: `StoryToTest: Generate Tests from User Stories`.

## Usage
1. Trigger the command from the Command Palette.
2. Paste a user story, for example: `As a user, I can add items to my shopping cart`.
3. The extension indexes your code, matches types, generates a test, and runs it.
4. If tests fail, it retries with the error context. Up to 3 attempts.
5. On success, the test is saved to `__tests__/` and opened.

## Settings
- `storytotest.openaiApiKey`: OpenAI API key (required).
- `storytotest.model`: OpenAI model name.

## Validation loop
- Supports Jest and Vitest. Unknown frameworks skip validation and return a warning.
- Commands used:
  - Jest: `npm test -- <file>`
  - Vitest: `npx vitest run <file>`
- Temp test files run in your workspace. Final file is written to `__tests__/`.

## Known limitations
- Framework detection and validation only cover Jest and Vitest.
- Story matching is simple (string matching on entity names); results depend on code naming.
- No Playwright auto-run yet.

## License
Apache 2.0 with attribution (see LICENSE).

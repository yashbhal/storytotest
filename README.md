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

## Early demo just to showcase the approximate idea
![Early demo just to showcase the approximate idea](./early-storytotest-demo-withfaults.gif)

## How It Works
1. Indexes your TypeScript files to extract interfaces and classes, tagging whether they are exported and whether they are default exports.
2. Parses the user story to identify entities.
3. Matches story entities to code symbols by simple name matching.
4. Generates a test using the matched types, prefilling imports for exported symbols and instructing the model not to import non-exported types.
5. Runs the test in a validation loop up to 3 times when using Jest/Vitest; temp files live in `__tests__` to keep relative imports correct. Playwright/unknown frameworks skip validation.

## Setup
1. Open a TypeScript workspace (must have `tsconfig.json` or `.ts/.tsx` files).
2. In VS Code settings, set `storytotest.openaiApiKey`.
3. Optionally set `storytotest.model` (default `gpt-4-turbo`).
4. Run the command: `StoryToTest: Generate Tests from User Stories`.
5. If no framework is detected, choose to scaffold Vitest (creates `vitest.config.ts` and `test/setupTests.ts`) or skip validation.

## Usage
1. Trigger the command from the Command Palette.
2. Paste a user story, for example: `As a user, I can add items to my shopping cart`.
3. The extension indexes your code, matches types, generates a test, and runs it when Jest/Vitest is detected. Playwright is detected but validation is not implemented; unknown frameworks can skip validation.
4. If tests fail, it retries with the error context. Up to 3 attempts.
5. On success, the test is saved to `__tests__/` and opened.

## Settings
- `storytotest.openaiApiKey`: OpenAI API key (required).
- `storytotest.model`: OpenAI model name.

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

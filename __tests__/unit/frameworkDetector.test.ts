import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectFramework } from "../../src/core/frameworkDetector";

describe("detectFramework", () => {
  function withTempDir(setup: (dir: string) => void): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framework-detector-"));
    setup(dir);
    return dir;
  }

  function cleanup(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  it("returns vitest when dependency is present", () => {
    const dir = withTempDir((d) => {
      fs.writeFileSync(
        path.join(d, "package.json"),
        JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
      );
    });
    try {
      assert.equal(detectFramework(dir), "vitest");
    } finally {
      cleanup(dir);
    }
  });

  it("returns jest when jest config file exists", () => {
    const dir = withTempDir((d) => {
      fs.writeFileSync(path.join(d, "jest.config.js"), "module.exports = {};");
    });
    try {
      assert.equal(detectFramework(dir), "jest");
    } finally {
      cleanup(dir);
    }
  });

  it("returns playwright when config file exists", () => {
    const dir = withTempDir((d) => {
      fs.writeFileSync(path.join(d, "playwright.config.ts"), "export default {};");
    });
    try {
      assert.equal(detectFramework(dir), "playwright");
    } finally {
      cleanup(dir);
    }
  });

  it("returns unknown when no signals found", () => {
    const dir = withTempDir(() => {
      // no setup
    });
    try {
      assert.equal(detectFramework(dir), "unknown");
    } finally {
      cleanup(dir);
    }
  });
});

import { strict as assert } from "assert";
import { resolveImport } from "../../src/core/importResolver";
import { InterfaceInfo } from "../../src/core/types";
import * as path from "path";

describe("resolveImport", () => {
  const baseInterface: InterfaceInfo = {
    name: "BlogCardProps",
    filePath: path.join("/repo/src", "components", "BlogCard.tsx"),
    properties: [],
    isDefaultExport: false,
    isExported: true,
  };

  it("builds a named import with relative path and posix separators", () => {
    const testDir = path.join("/repo", "__tests__");
    const result = resolveImport(baseInterface, testDir);

    assert.equal(result, 'import { BlogCardProps } from "../src/components/BlogCard";');
  });

  it("prefers default import when interface is default export", () => {
    const testDir = path.join("/repo", "__tests__");
    const result = resolveImport({ ...baseInterface, isDefaultExport: true }, testDir);

    assert.equal(result, 'import BlogCardProps from "../src/components/BlogCard";');
  });

  it("prefixes ./ when relative path lacks dot prefix", () => {
    const testDir = path.join("/repo", "src", "components");
    const result = resolveImport(baseInterface, testDir);

    assert.equal(result, 'import { BlogCardProps } from "./BlogCard";');
  });

  it("falls back to DefaultExport name when name is missing", () => {
    const testDir = path.join("/repo", "__tests__");
    const result = resolveImport({ ...baseInterface, name: "" }, testDir);

    assert.equal(result, 'import { DefaultExport } from "../src/components/BlogCard";');
  });
});

import { strict as assert } from "assert";
import { searchComponents } from "../../src/core/componentSearch";
import { CodebaseIndex } from "../../src/core/types";

describe("searchComponents", () => {
  const baseIndex: CodebaseIndex = {
    interfaces: [
      { name: "BlogCardProps", filePath: "/repo/src/BlogCard.ts", properties: [], isDefaultExport: false, isExported: true },
      { name: "UserProfile", filePath: "/repo/src/UserProfile.ts", properties: [], isDefaultExport: false, isExported: true },
    ],
    classes: [
      { name: "CheckoutService", filePath: "/repo/src/CheckoutService.ts", methods: [], isDefaultExport: false, isExported: true },
      { name: "Cart", filePath: "/repo/src/Cart.ts", methods: [], isDefaultExport: false, isExported: true },
    ],
  };

  it("matches interfaces and classes when entity is contained in the name", () => {
    const result = searchComponents(baseIndex, ["checkout", "profile"]);

    assert.equal(result.matchedInterfaces.length, 1);
    assert.equal(result.matchedInterfaces[0].name, "UserProfile");
    assert.equal(result.matchedClasses.length, 1);
    assert.equal(result.matchedClasses[0].name, "CheckoutService");
  });

  it("matches when name contains the full entity string (bidirectional)", () => {
    const result = searchComponents(baseIndex, ["blogcardprops", "car"]);

    assert.equal(result.matchedInterfaces.length, 1);
    assert.equal(result.matchedInterfaces[0].name, "BlogCardProps");
    assert.equal(result.matchedClasses.length, 1);
    assert.equal(result.matchedClasses[0].name, "Cart");
  });

  it("returns empty matches when no entities provided", () => {
    const result = searchComponents(baseIndex, []);

    assert.deepEqual(result.matchedInterfaces, []);
    assert.deepEqual(result.matchedClasses, []);
  });
});

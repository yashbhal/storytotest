import { strict as assert } from "assert";
import { parseStory } from "../../src/core/storyParser";

describe("parseStory", () => {
  it("extracts quoted entities and lowercases them", () => {
    const story = 'As a user, I can open the "BlogCard" component for "Admin" roles';
    const result = parseStory(story);

    assert.ok(result.entities.includes("blogcard"));
    assert.ok(result.entities.includes("admin"));
  });

  it("filters stopwords and short words while keeping meaningful entities", () => {
    const story = "A user can add new item to cart and checkout";
    const result = parseStory(story);

    assert.ok(result.entities.includes("user"));
    assert.ok(result.entities.includes("item"));
    assert.ok(!result.entities.includes("and"));
    assert.ok(!result.entities.includes("new"));
  });

  it("captures action verbs and removes duplicates", () => {
    const story = "User can view and view existing records, then update them";
    const result = parseStory(story);

    assert.deepEqual(result.actions.sort(), ["update", "view"]);
  });

  it("returns empty entities and actions for empty input", () => {
    const result = parseStory("");

    assert.equal(result.rawText, "");
    assert.deepEqual(result.entities, []);
    assert.deepEqual(result.actions, []);
  });
});

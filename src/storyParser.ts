export interface ParsedStory {
  rawText: string;
  entities: string[]; // Extracted nouns/concepts
  actions: string[]; // Extracted verbs
}

export function parseStory(storyText: string): ParsedStory {
  // Simple extraction: find quoted words and common nouns
  const entities: string[] = [];
  const actions: string[] = [];

  // Extract quoted text (e.g., "shopping cart" → shopping cart)
  const quotedMatches = storyText.match(/"([^"]+)"/g);
  if (quotedMatches) {
    quotedMatches.forEach((match) => {
      const cleaned = match.replace(/"/g, "").toLowerCase();
      entities.push(cleaned);
    });
  }

  // Extract common patterns (basic NLP)
  const words = storyText.toLowerCase().split(/\s+/);

  // Look for entities after "a/an/the"
  for (let i = 0; i < words.length - 1; i++) {
    if (["a", "an", "the"].includes(words[i])) {
      const entity = words[i + 1].replace(/[^a-z]/g, "");
      if (entity.length > 2) {
        entities.push(entity);
      }
    }
  }

  // Common action verbs
  const actionVerbs = [
    "add",
    "remove",
    "delete",
    "create",
    "update",
    "view",
    "edit",
    "search",
    "filter",
  ];
  words.forEach((word) => {
    const cleaned = word.replace(/[^a-z]/g, "");
    if (actionVerbs.includes(cleaned)) {
      actions.push(cleaned);
    }
  });

  // Remove duplicates
  return {
    rawText: storyText,
    entities: [...new Set(entities)],
    actions: [...new Set(actions)],
  };
}

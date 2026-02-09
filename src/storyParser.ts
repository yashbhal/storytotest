export interface ParsedStory {
  rawText: string;
  entities: string[]; // Extracted nouns/concepts
  actions: string[]; // Extracted verbs
}

export function parseStory(storyText: string): ParsedStory {
  const entities: string[] = [];
  const actions: string[] = [];

  // Extract quoted text
  const quotedMatches = storyText.match(/"([^"]+)"/g);
  if (quotedMatches) {
    quotedMatches.forEach((match) => {
      const cleaned = match.replace(/"/g, "").toLowerCase();
      entities.push(cleaned);
    });
  }

  const words = storyText.toLowerCase().split(/\s+/);

  // Extract all meaningful words (length > 3, not stopwords)
  const stopwords = [
    "a",
    "an",
    "the",
    "can",
    "should",
    "will",
    "would",
    "could",
    "as",
    "to",
    "from",
    "with",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "by",
    "for",
    "of",
    "is",
    "are",
    "was",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "new",
    "old",
  ];

  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, "");

    // Keep words that are:
    // - Longer than 3 characters
    // - Not stopwords
    // - Not already in entities
    if (
      cleaned.length > 3 &&
      !stopwords.includes(cleaned) &&
      !entities.includes(cleaned)
    ) {
      entities.push(cleaned);
    }
  }

  // Extract action verbs
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

  return {
    rawText: storyText,
    entities: [...new Set(entities)], // Remove duplicates
    actions: [...new Set(actions)],
  };
}

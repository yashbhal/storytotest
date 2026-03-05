import { CodebaseIndex, InterfaceInfo, ClassInfo, SearchResult } from "./types";

export { SearchResult };

/**
 * Performs a simple substring match between parsed story entities and indexed interfaces/classes.
 * Matching is case-insensitive and bidirectional (entity in name or name in entity).
 * @param index codebase index containing interfaces/classes
 * @param entities lowercased story entities extracted from the user story
 * @returns matched interfaces and classes
 */
export function searchComponents(
  index: CodebaseIndex,
  entities: string[],
): SearchResult {
  const matchedInterfaces: InterfaceInfo[] = [];
  const matchedClasses: ClassInfo[] = [];

  // get matched interfaces
  for (const iface of index.interfaces) {
    const interfaceName = iface.name.toLowerCase();

    for (const entity of entities) {
      if (interfaceName.includes(entity) || entity.includes(interfaceName)) {
        matchedInterfaces.push(iface);
        break;
      }
    }
  }

  // get matched classes
  for (const cls of index.classes) {
    const className = cls.name.toLowerCase();

    for (const entity of entities) {
      if (className.includes(entity) || entity.includes(className)) {
        matchedClasses.push(cls);
        break;
      }
    }
  }

  return {
    matchedInterfaces,
    matchedClasses,
  };
}

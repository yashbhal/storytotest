import { CodebaseIndex, InterfaceInfo, ClassInfo, SearchResult } from "./types";

export { SearchResult };

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

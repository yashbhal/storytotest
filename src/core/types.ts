export interface InterfaceInfo {
  name: string;
  filePath: string;
  properties: Array<{
    name: string;
    type: string;
  }>;
  isDefaultExport: boolean;
  isExported: boolean;
}

export interface ClassInfo {
  name: string;
  filePath: string;
  methods: string[];
  isDefaultExport: boolean;
  isExported: boolean;
}

export interface CodebaseIndex {
  interfaces: InterfaceInfo[];
  classes: ClassInfo[];
}

export interface SearchResult {
  matchedInterfaces: InterfaceInfo[];
  matchedClasses: ClassInfo[];
}

export interface GeneratedTest {
  code: string;
  fileName: string;
}

export interface ValidationResult {
  code: string;
  fileName: string;
  attempts: number;
  passed: boolean;
  lastError: string | null;
}

export interface TestResult {
  passed: boolean;
  error: string | null;
}

export interface ParsedStory {
  rawText: string;
  entities: string[];
  actions: string[];
}

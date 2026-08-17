export interface ExportOptions {
  name: string;
  version: string;
  contentHash: string;
  toolLanguage: "python" | "bash";
  includeMemory: boolean;
  generatorVersion?: string;
}

export interface GeneratedFile {
  path: string;
  contents: string;
  mode?: number;
}

export interface FsmDsl {
  name?: string;
  states: unknown[];
  [k: string]: unknown;
}

export const DEFAULT_GENERATOR_VERSION = "0.1.0";
export const MEMORY_NODE_CAP = 256;

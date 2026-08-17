export type CodeSymbolKind =
  | "function"
  | "class"
  | "method"
  | "type"
  | "module";

export interface ExtractedSymbol {
  kind: CodeSymbolKind;
  name: string;
  intent: string;
  identity: string;
  startLine?: number;
  endLine?: number;
}

export interface IndexStats {
  symbolCount: number;
  fileCount: number;
  lastIndexedAt: string | null;
}

export interface IndexPathSuccess {
  ok: true;
  symbols: Array<{
    filePath: string;
    name: string;
    kind: CodeSymbolKind;
    intent: string;
    identity: string;
  }>;
  fileCount: number;
  symbolCount: number;
  skippedLarge: number;
}

export type IndexPathResult = IndexPathSuccess;

export interface IndexPathError {
  ok: false;
  error: string;
}

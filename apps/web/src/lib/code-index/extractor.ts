import ts from "typescript";
import type { CodeSymbolKind, ExtractedSymbol } from "./types";

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function endLineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function jsDocSummary(node: ts.Node): string | undefined {
  const full = ts.getJSDocCommentsAndTags(node);
  for (const item of full) {
    if (ts.isJSDoc(item) && item.comment) {
      const text =
        typeof item.comment === "string"
          ? item.comment
          : item.comment.map((c) => c.text).join("");
      const trimmed = text.trim();
      if (trimmed) return trimmed.split(/\r?\n/)[0].trim();
    }
  }
  return undefined;
}

function typeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isFunctionLike(node)) {
    const params = node.parameters
      .map((p) => {
        const name = p.name.getText(sourceFile);
        const type = p.type ? p.type.getText(sourceFile) : "any";
        return `${name}: ${type}`;
      })
      .join(", ");
    const ret =
      node.type?.getText(sourceFile) ??
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
        ? "void"
        : "any");
    return `(${params}) -> ${ret}`;
  }
  return "";
}

function enclosingClass(node: ts.Node): string | undefined {
  let parent = node.parent;
  while (parent) {
    if (ts.isClassDeclaration(parent) && parent.name) {
      return parent.name.text;
    }
    parent = parent.parent;
  }
  return undefined;
}

function intentFor(
  kind: CodeSymbolKind,
  name: string,
  identity: string,
  node: ts.Node
): string {
  const doc = jsDocSummary(node);
  if (doc) return doc;
  return `${kind} ${identity || name}`;
}

function pushSymbol(
  symbols: ExtractedSymbol[],
  sourceFile: ts.SourceFile,
  kind: CodeSymbolKind,
  name: string,
  identity: string,
  node: ts.Node
) {
  symbols.push({
    kind,
    name,
    intent: intentFor(kind, name, identity, node),
    identity,
    startLine: lineOf(sourceFile, node),
    endLine: endLineOf(sourceFile, node),
  });
}

export function extractSymbols(
  filePath: string,
  content: string
): ExtractedSymbol[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const symbols: ExtractedSymbol[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      pushSymbol(
        symbols,
        sourceFile,
        "class",
        name,
        `class ${name}`,
        node
      );
    }

    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const methodName = node.name.text;
      const sig = typeText(node, sourceFile);
      const owner = enclosingClass(node);
      const identity = owner
        ? `${owner}.${methodName}${sig}`
        : `${methodName}${sig}`;
      pushSymbol(
        symbols,
        sourceFile,
        "method",
        methodName,
        identity,
        node
      );
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const sig = typeText(node, sourceFile);
      pushSymbol(
        symbols,
        sourceFile,
        "function",
        name,
        `${name}${sig}`,
        node
      );
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      if (
        init &&
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
      ) {
        const name = node.name.text;
        const sig = typeText(init, sourceFile);
        pushSymbol(
          symbols,
          sourceFile,
          "function",
          name,
          `${name}${sig}`,
          init
        );
      }
    }

    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      pushSymbol(
        symbols,
        sourceFile,
        "type",
        name,
        `interface ${name}`,
        node
      );
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const body = node.type.getText(sourceFile);
      pushSymbol(
        symbols,
        sourceFile,
        "type",
        name,
        `type ${name} = ${body}`,
        node
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (symbols.length === 0) {
    const rel = filePath.replace(/\\/g, "/");
    pushSymbol(
      symbols,
      sourceFile,
      "module",
      rel,
      `module ${rel}`,
      sourceFile
    );
  }

  return symbols;
}

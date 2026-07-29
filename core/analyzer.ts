import { parse, type ParserPlugin } from "@babel/parser";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export const DEFAULT_EXCLUDED_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".git",
  ".turbo",
  ".cache",
] as const;

type AstNode = {
  type: string;
  [key: string]: unknown;
};

type AstFile = AstNode & {
  program: AstNode & {
    body: AstNode[];
  };
};

export type DiagnosticSeverity = "error" | "warning";

export type ImportKind =
  | "default"
  | "named"
  | "namespace"
  | "side-effect"
  | "dynamic"
  | "commonjs";

export type ExportKind =
  | "default"
  | "named"
  | "type"
  | "commonjs"
  | "reexport";

export interface ImportSymbol {
  source: string;
  imported: string;
  local: string;
  kind: ImportKind;
  typeOnly: boolean;
  line?: number;
}

export interface ExportSymbol {
  name: string;
  local: string;
  kind: ExportKind;
  typeOnly: boolean;
  source?: string;
  imported?: string;
  line?: number;
}

export interface ReexportSymbol {
  source: string;
  imported: string;
  exported?: string;
  typeOnly: boolean;
  line?: number;
}

export interface Diagnostic {
  code: "PARSE_ERROR" | "READ_ERROR" | "UNRESOLVED_IMPORT" | "UNUSED_EXPORT";
  severity: DiagnosticSeverity;
  message: string;
  file: string;
  line?: number;
  symbol?: string;
}

export interface FileAnalysis {
  absolutePath: string;
  path: string;
  imports: ImportSymbol[];
  exports: ExportSymbol[];
  reexports: ReexportSymbol[];
  diagnostics: Diagnostic[];
}

export interface UnusedExport {
  file: string;
  name: string;
  typeOnly: boolean;
  line?: number;
}

export interface AnalysisTotals {
  files: number;
  imports: number;
  exports: number;
  unusedExports: number;
  unresolvedImports: number;
  parseErrors: number;
  errors: number;
  warnings: number;
}

export interface ProjectAnalysis {
  root: string;
  files: FileAnalysis[];
  diagnostics: Diagnostic[];
  unusedExports: UnusedExport[];
  totals: AnalysisTotals;
  durationMs: number;
}

export interface AnalyzeProjectOptions {
  exclude?: string[];
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function getNodeName(value: unknown): string | null {
  if (!isAstNode(value)) return null;

  if (value.type === "Identifier" || value.type === "PrivateName") {
    const name = value.name;
    if (typeof name === "string") return name;
    return getNodeName(value.id);
  }

  if (
    value.type === "StringLiteral" ||
    value.type === "NumericLiteral" ||
    value.type === "BigIntLiteral"
  ) {
    const literal = value.value;
    return typeof literal === "string" || typeof literal === "number"
      ? String(literal)
      : null;
  }

  return null;
}

function getLine(node: AstNode): number | undefined {
  const loc = node.loc;
  if (
    typeof loc === "object" &&
    loc !== null &&
    "start" in loc &&
    typeof loc.start === "object" &&
    loc.start !== null &&
    "line" in loc.start &&
    typeof loc.start.line === "number"
  ) {
    return loc.start.line;
  }

  return undefined;
}

function extractBindingNames(node: unknown): string[] {
  if (!isAstNode(node)) return [];

  switch (node.type) {
    case "Identifier":
      return typeof node.name === "string" ? [node.name] : [];
    case "RestElement":
      return extractBindingNames(node.argument);
    case "AssignmentPattern":
      return extractBindingNames(node.left);
    case "ArrayPattern":
      return Array.isArray(node.elements)
        ? node.elements.flatMap(extractBindingNames)
        : [];
    case "ObjectPattern":
      return Array.isArray(node.properties)
        ? node.properties.flatMap((property) => {
            if (!isAstNode(property)) return [];
            if (property.type === "RestElement") {
              return extractBindingNames(property.argument);
            }
            return extractBindingNames(property.value);
          })
        : [];
    case "TSParameterProperty":
      return extractBindingNames(node.parameter);
    default:
      return [];
  }
}

function declarationNames(node: unknown): string[] {
  if (!isAstNode(node)) return [];

  if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
    return node.declarations.flatMap((declaration) =>
      isAstNode(declaration) ? extractBindingNames(declaration.id) : [],
    );
  }

  const namedDeclarationTypes = new Set([
    "FunctionDeclaration",
    "ClassDeclaration",
    "TSDeclareFunction",
    "TSInterfaceDeclaration",
    "TSTypeAliasDeclaration",
    "TSEnumDeclaration",
    "TSModuleDeclaration",
    "DeclareFunction",
    "DeclareClass",
    "DeclareInterface",
    "DeclareTypeAlias",
    "OpaqueType",
  ]);

  if (namedDeclarationTypes.has(node.type)) {
    const name = getNodeName(node.id);
    return name ? [name] : [];
  }

  return [];
}

function isTypeDeclaration(node: unknown): boolean {
  return (
    isAstNode(node) &&
    (node.type.startsWith("TS") ||
      node.type.startsWith("Declare") ||
      node.type === "OpaqueType")
  );
}

function parserPlugins(filePath: string): ParserPlugin[] {
  const isTypeScript = /\.(?:ts|tsx|mts|cts)$/i.test(filePath);
  const plugins: ParserPlugin[] = ["jsx", "decorators-legacy"];

  if (isTypeScript) {
    plugins.push([
      "typescript",
      {
        dts: /\.d\.(?:ts|mts|cts)$/i.test(filePath),
        disallowAmbiguousJSXLike: /\.(?:mts|cts)$/i.test(filePath),
      },
    ]);
  }

  return plugins;
}

function addImport(target: ImportSymbol[], symbol: ImportSymbol): void {
  const key = [
    symbol.source,
    symbol.imported,
    symbol.local,
    symbol.kind,
    symbol.typeOnly,
  ].join("\u0000");

  if (
    !target.some(
      (item) =>
        [
          item.source,
          item.imported,
          item.local,
          item.kind,
          item.typeOnly,
        ].join("\u0000") === key,
    )
  ) {
    target.push(symbol);
  }
}

function addExport(target: ExportSymbol[], symbol: ExportSymbol): void {
  const key = [
    symbol.name,
    symbol.local,
    symbol.kind,
    symbol.source ?? "",
    symbol.imported ?? "",
  ].join("\u0000");

  if (
    !target.some(
      (item) =>
        [
          item.name,
          item.local,
          item.kind,
          item.source ?? "",
          item.imported ?? "",
        ].join("\u0000") === key,
    )
  ) {
    target.push(symbol);
  }
}

function readStaticImports(body: AstNode[], imports: ImportSymbol[]): void {
  for (const node of body) {
    if (node.type === "ImportDeclaration") {
      const source = getNodeName(node.source);
      if (!source) continue;

      const declarationTypeOnly = node.importKind === "type";
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];

      if (specifiers.length === 0) {
        addImport(imports, {
          source,
          imported: "(side effect)",
          local: "",
          kind: "side-effect",
          typeOnly: false,
          line: getLine(node),
        });
        continue;
      }

      for (const specifier of specifiers) {
        if (!isAstNode(specifier)) continue;

        const local = getNodeName(specifier.local) ?? "";
        const typeOnly = declarationTypeOnly || specifier.importKind === "type";

        if (specifier.type === "ImportDefaultSpecifier") {
          addImport(imports, {
            source,
            imported: "default",
            local,
            kind: "default",
            typeOnly,
            line: getLine(specifier),
          });
        } else if (specifier.type === "ImportNamespaceSpecifier") {
          addImport(imports, {
            source,
            imported: "*",
            local,
            kind: "namespace",
            typeOnly,
            line: getLine(specifier),
          });
        } else if (specifier.type === "ImportSpecifier") {
          addImport(imports, {
            source,
            imported: getNodeName(specifier.imported) ?? local,
            local,
            kind: "named",
            typeOnly,
            line: getLine(specifier),
          });
        }
      }
    } else if (node.type === "TSImportEqualsDeclaration") {
      const sourceNode = isAstNode(node.moduleReference)
        ? node.moduleReference.expression
        : null;
      const source = getNodeName(sourceNode);
      const local = getNodeName(node.id);
      if (source && local) {
        addImport(imports, {
          source,
          imported: "*",
          local,
          kind: "commonjs",
          typeOnly: Boolean(node.isTypeOnly),
          line: getLine(node),
        });
      }
    }
  }
}

function readStaticExports(
  body: AstNode[],
  exports: ExportSymbol[],
  reexports: ReexportSymbol[],
): void {
  for (const node of body) {
    if (node.type === "ExportDefaultDeclaration") {
      const declaration = isAstNode(node.declaration) ? node.declaration : null;
      addExport(exports, {
        name: "default",
        local: declaration ? getNodeName(declaration.id) ?? "default" : "default",
        kind: "default",
        typeOnly: false,
        line: getLine(node),
      });
      continue;
    }

    if (node.type === "ExportAllDeclaration") {
      const source = getNodeName(node.source);
      if (!source) continue;

      const exported = getNodeName(node.exported);
      if (exported) {
        addExport(exports, {
          name: exported,
          local: "*",
          kind: "reexport",
          typeOnly: node.exportKind === "type",
          source,
          imported: "*",
          line: getLine(node),
        });
      }

      reexports.push({
        source,
        imported: "*",
        exported: exported ?? undefined,
        typeOnly: node.exportKind === "type",
        line: getLine(node),
      });
      continue;
    }

    if (node.type === "TSExportAssignment") {
      addExport(exports, {
        name: "default",
        local: "export=",
        kind: "default",
        typeOnly: false,
        line: getLine(node),
      });
      continue;
    }

    if (node.type !== "ExportNamedDeclaration") continue;

    const source = getNodeName(node.source);
    const declaration = isAstNode(node.declaration) ? node.declaration : null;
    const declarationTypeOnly =
      node.exportKind === "type" || isTypeDeclaration(declaration);

    if (declaration) {
      for (const name of declarationNames(declaration)) {
        addExport(exports, {
          name,
          local: name,
          kind: declarationTypeOnly ? "type" : "named",
          typeOnly: declarationTypeOnly,
          line: getLine(declaration),
        });
      }
    }

    const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
    for (const specifier of specifiers) {
      if (!isAstNode(specifier)) continue;

      const exported = getNodeName(specifier.exported);
      if (!exported) continue;

      const imported =
        specifier.type === "ExportNamespaceSpecifier"
          ? "*"
          : getNodeName(specifier.local) ?? exported;
      const typeOnly =
        declarationTypeOnly || specifier.exportKind === "type";

      addExport(exports, {
        name: exported,
        local: imported,
        kind: source ? "reexport" : typeOnly ? "type" : "named",
        typeOnly,
        source: source ?? undefined,
        imported: source ? imported : undefined,
        line: getLine(specifier),
      });

      if (source) {
        reexports.push({
          source,
          imported,
          exported,
          typeOnly,
          line: getLine(specifier),
        });
      }
    }
  }
}

const IGNORED_AST_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "innerComments",
  "trailingComments",
  "comments",
  "tokens",
  "errors",
]);

function walkAst(
  node: AstNode,
  visitor: (node: AstNode, parent: AstNode | null) => void,
  parent: AstNode | null = null,
): void {
  visitor(node, parent);

  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_AST_KEYS.has(key)) continue;

    if (isAstNode(value)) {
      walkAst(value, visitor, node);
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walkAst(child, visitor, node);
      }
    }
  }
}

function stringArgument(node: unknown): string | null {
  if (!isAstNode(node)) return null;
  return node.type === "StringLiteral" && typeof node.value === "string"
    ? node.value
    : null;
}

function memberPropertyName(node: unknown): string | null {
  if (!isAstNode(node) || node.type !== "MemberExpression") return null;
  return getNodeName(node.property);
}

function commonJsBinding(
  call: AstNode,
  parent: AstNode | null,
): { imported: string; local: string } {
  if (!parent) return { imported: "(side effect)", local: "" };
  if (parent.type === "ExpressionStatement") {
    return { imported: "(side effect)", local: "" };
  }

  if (parent.type === "MemberExpression" && parent.object === call) {
    const imported = memberPropertyName(parent);
    return { imported: imported ?? "*", local: imported ?? "" };
  }

  if (parent.type === "VariableDeclarator" && parent.init === call) {
    const id = isAstNode(parent.id) ? parent.id : null;
    if (id?.type === "Identifier") {
      return {
        imported: "*",
        local: getNodeName(id) ?? "",
      };
    }
  }

  return { imported: "*", local: "" };
}

function readRuntimeImportsAndExports(
  ast: AstFile,
  imports: ImportSymbol[],
  exports: ExportSymbol[],
): void {
  walkAst(ast.program, (node, parent) => {
    if (node.type === "ImportExpression") {
      const source = stringArgument(node.source);
      if (source) {
        addImport(imports, {
          source,
          imported: "*",
          local: "",
          kind: "dynamic",
          typeOnly: false,
          line: getLine(node),
        });
      }
      return;
    }

    if (node.type === "CallExpression") {
      const callee = isAstNode(node.callee) ? node.callee : null;
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      const source = stringArgument(args[0]);

      if (source && callee?.type === "Import") {
        addImport(imports, {
          source,
          imported: "*",
          local: "",
          kind: "dynamic",
          typeOnly: false,
          line: getLine(node),
        });
        return;
      }

      if (
        source &&
        callee?.type === "Identifier" &&
        callee.name === "require"
      ) {
        const binding = commonJsBinding(node, parent);

        if (
          parent?.type === "VariableDeclarator" &&
          parent.init === node &&
          isAstNode(parent.id) &&
          parent.id.type === "ObjectPattern" &&
          Array.isArray(parent.id.properties)
        ) {
          for (const property of parent.id.properties) {
            if (!isAstNode(property)) continue;
            const imported = getNodeName(property.key);
            const localNames = extractBindingNames(property.value);
            if (!imported) continue;
            for (const local of localNames) {
              addImport(imports, {
                source,
                imported,
                local,
                kind: "commonjs",
                typeOnly: false,
                line: getLine(node),
              });
            }
          }
        } else {
          addImport(imports, {
            source,
            imported: binding.imported,
            local: binding.local,
            kind:
              binding.imported === "(side effect)"
                ? "side-effect"
                : "commonjs",
            typeOnly: false,
            line: getLine(node),
          });
        }
      }
      return;
    }

    if (node.type !== "AssignmentExpression") return;
    const left = isAstNode(node.left) ? node.left : null;
    if (!left || left.type !== "MemberExpression") return;

    const object = isAstNode(left.object) ? left.object : null;
    const property = memberPropertyName(left);

    if (
      object?.type === "Identifier" &&
      object.name === "exports" &&
      property
    ) {
      addExport(exports, {
        name: property,
        local: property,
        kind: "commonjs",
        typeOnly: false,
        line: getLine(node),
      });
      return;
    }

    if (
      object?.type === "MemberExpression" &&
      isAstNode(object.object) &&
      object.object.type === "Identifier" &&
      object.object.name === "module" &&
      memberPropertyName(object) === "exports" &&
      property
    ) {
      addExport(exports, {
        name: property,
        local: property,
        kind: "commonjs",
        typeOnly: false,
        line: getLine(node),
      });
      return;
    }

    if (
      object?.type === "Identifier" &&
      object.name === "module" &&
      property === "exports"
    ) {
      addExport(exports, {
        name: "default",
        local: "module.exports",
        kind: "commonjs",
        typeOnly: false,
        line: getLine(node),
      });
    }
  });
}

function toRelativePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath) || path.basename(filePath);
  return relative.split(path.sep).join("/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function analyzeFile(
  absolutePath: string,
  root: string,
): Promise<FileAnalysis> {
  const relativePath = toRelativePath(root, absolutePath);
  const diagnostics: Diagnostic[] = [];
  let source: string;

  try {
    source = await Bun.file(absolutePath).text();
  } catch (error) {
    diagnostics.push({
      code: "READ_ERROR",
      severity: "error",
      file: relativePath,
      message: `Unable to read file: ${errorMessage(error)}`,
    });
    return {
      absolutePath,
      path: relativePath,
      imports: [],
      exports: [],
      reexports: [],
      diagnostics,
    };
  }

  let ast: AstFile;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: parserPlugins(absolutePath),
      allowReturnOutsideFunction: true,
    }) as unknown as AstFile;
  } catch (error) {
    const line =
      typeof error === "object" &&
      error !== null &&
      "loc" in error &&
      typeof error.loc === "object" &&
      error.loc !== null &&
      "line" in error.loc &&
      typeof error.loc.line === "number"
        ? error.loc.line
        : undefined;

    diagnostics.push({
      code: "PARSE_ERROR",
      severity: "error",
      file: relativePath,
      line,
      message: `Unable to parse file: ${errorMessage(error)}`,
    });
    return {
      absolutePath,
      path: relativePath,
      imports: [],
      exports: [],
      reexports: [],
      diagnostics,
    };
  }

  const imports: ImportSymbol[] = [];
  const exports: ExportSymbol[] = [];
  const reexports: ReexportSymbol[] = [];

  readStaticImports(ast.program.body, imports);
  readStaticExports(ast.program.body, exports, reexports);
  readRuntimeImportsAndExports(ast, imports, exports);

  return {
    absolutePath,
    path: relativePath,
    imports,
    exports,
    reexports,
    diagnostics,
  };
}

function isSourceFile(fileName: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) =>
    fileName.toLowerCase().endsWith(extension),
  );
}

async function collectSourceFiles(
  root: string,
  exclude: Set<string>,
): Promise<string[]> {
  const files: string[] = [];
  const directories = [root];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        directories.push(absolutePath);
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function resolutionCandidates(basePath: string): string[] {
  const candidates = [basePath];
  const extension = path.extname(basePath).toLowerCase();

  if (!extension) {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${sourceExtension}`);
    }
  } else {
    const extensionAliases: Record<string, readonly string[]> = {
      ".js": [".ts", ".tsx"],
      ".jsx": [".tsx", ".ts"],
      ".mjs": [".mts"],
      ".cjs": [".cts"],
    };
    for (const alias of extensionAliases[extension] ?? []) {
      candidates.push(basePath.slice(0, -extension.length) + alias);
    }
  }

  for (const sourceExtension of SOURCE_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${sourceExtension}`));
  }

  return candidates;
}

function resolveLocalSource(
  fromFile: string,
  source: string,
  fileSet: Set<string>,
): string | null {
  if (!source.startsWith(".") && !path.isAbsolute(source)) return null;

  const cleanSource = source.split(/[?#]/, 1)[0] ?? source;
  const basePath = path.isAbsolute(cleanSource)
    ? path.normalize(cleanSource)
    : path.resolve(path.dirname(fromFile), cleanSource);

  for (const candidate of resolutionCandidates(basePath)) {
    const normalized = path.normalize(candidate);
    if (fileSet.has(normalized)) return normalized;
  }

  return null;
}

function isLocalSource(source: string): boolean {
  return source.startsWith(".") || path.isAbsolute(source);
}

function isAnalyzableLocalSource(source: string): boolean {
  if (!isLocalSource(source)) return false;
  const cleanSource = source.split(/[?#]/, 1)[0] ?? source;
  const extension = path.extname(cleanSource).toLowerCase();
  return (
    extension.length === 0 ||
    SOURCE_EXTENSIONS.some((sourceExtension) => sourceExtension === extension)
  );
}

function exportKey(filePath: string, name: string): string {
  return `${filePath}\u0000${name}`;
}

function finalizeAnalysis(
  root: string,
  files: FileAnalysis[],
  startedAt: number,
): ProjectAnalysis {
  const fileSet = new Set(files.map((file) => file.absolutePath));
  const fileMap = new Map(files.map((file) => [file.absolutePath, file]));
  const resolutionCache = new Map<string, string | null>();
  const usedExports = new Set<string>();

  const resolve = (fromFile: string, source: string): string | null => {
    const key = `${fromFile}\u0000${source}`;
    if (!resolutionCache.has(key)) {
      resolutionCache.set(
        key,
        resolveLocalSource(fromFile, source, fileSet),
      );
    }
    return resolutionCache.get(key) ?? null;
  };

  const hasExport = (
    filePath: string,
    name: string,
    seen = new Set<string>(),
  ): boolean => {
    const key = exportKey(filePath, name);
    if (seen.has(key)) return false;
    seen.add(key);

    const file = fileMap.get(filePath);
    if (!file) return false;
    if (file.exports.some((item) => item.name === name)) return true;

    return file.reexports.some((reexport) => {
      if (reexport.imported !== "*" || reexport.exported) return false;
      if (name === "default") return false;
      const target = resolve(filePath, reexport.source);
      return target ? hasExport(target, name, seen) : false;
    });
  };

  const markStarReexportsUsed = (
    filePath: string,
    seen: Set<string>,
  ): void => {
    const key = exportKey(filePath, "(star reexport)");
    if (seen.has(key)) return;
    seen.add(key);

    const file = fileMap.get(filePath);
    if (!file) return;
    for (const item of file.exports) {
      if (item.name !== "default") markUsed(filePath, item.name, seen);
    }
    for (const reexport of file.reexports) {
      if (reexport.imported !== "*" || reexport.exported) continue;
      const target = resolve(filePath, reexport.source);
      if (target) markStarReexportsUsed(target, seen);
    }
  };

  const markUsed = (
    filePath: string,
    name: string,
    seen = new Set<string>(),
  ): void => {
    const key = exportKey(filePath, name);
    if (seen.has(key)) return;
    seen.add(key);

    const file = fileMap.get(filePath);
    if (!file) return;

    if (name === "*") {
      for (const item of file.exports) {
        usedExports.add(exportKey(filePath, item.name));
        if (item.source && item.imported) {
          const target = resolve(filePath, item.source);
          if (target) markUsed(target, item.imported, seen);
        }
      }
      for (const reexport of file.reexports) {
        if (reexport.exported) continue;
        const target = resolve(filePath, reexport.source);
        if (target) markStarReexportsUsed(target, seen);
      }
      return;
    }

    const direct = file.exports.filter((item) => item.name === name);
    for (const item of direct) {
      usedExports.add(exportKey(filePath, item.name));
      if (item.source && item.imported) {
        const target = resolve(filePath, item.source);
        if (target) markUsed(target, item.imported, seen);
      }
    }

    for (const reexport of file.reexports) {
      if (reexport.imported !== "*" || reexport.exported) continue;
      const target = resolve(filePath, reexport.source);
      if (target && hasExport(target, name)) markUsed(target, name, seen);
    }
  };

  for (const file of files) {
    const localSources = new Map<string, number | undefined>();

    for (const imported of file.imports) {
      if (!isAnalyzableLocalSource(imported.source)) continue;
      localSources.set(imported.source, imported.line);

      const target = resolve(file.absolutePath, imported.source);
      if (!target || imported.kind === "side-effect") continue;
      markUsed(target, imported.imported);
    }

    for (const reexport of file.reexports) {
      if (!isAnalyzableLocalSource(reexport.source)) continue;
      localSources.set(reexport.source, reexport.line);
    }

    for (const [source, line] of localSources) {
      if (resolve(file.absolutePath, source)) continue;
      file.diagnostics.push({
        code: "UNRESOLVED_IMPORT",
        severity: "error",
        file: file.path,
        line,
        message: `Cannot resolve local module "${source}".`,
      });
    }
  }

  const unusedExports: UnusedExport[] = [];
  for (const file of files) {
    for (const exported of file.exports) {
      if (usedExports.has(exportKey(file.absolutePath, exported.name))) {
        continue;
      }

      const unused: UnusedExport = {
        file: file.path,
        name: exported.name,
        typeOnly: exported.typeOnly,
        line: exported.line,
      };
      unusedExports.push(unused);
      file.diagnostics.push({
        code: "UNUSED_EXPORT",
        severity: "warning",
        file: file.path,
        line: exported.line,
        symbol: exported.name,
        message: `Export "${exported.name}" is not imported by another scanned file.`,
      });
    }
  }

  unusedExports.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.name.localeCompare(right.name),
  );

  const diagnostics = files
    .flatMap((file) => file.diagnostics)
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        (left.line ?? 0) - (right.line ?? 0) ||
        left.code.localeCompare(right.code),
    );

  return {
    root,
    files,
    diagnostics,
    unusedExports,
    totals: {
      files: files.length,
      imports: files.reduce((sum, file) => sum + file.imports.length, 0),
      exports: files.reduce((sum, file) => sum + file.exports.length, 0),
      unusedExports: unusedExports.length,
      unresolvedImports: diagnostics.filter(
        (diagnostic) => diagnostic.code === "UNRESOLVED_IMPORT",
      ).length,
      parseErrors: diagnostics.filter(
        (diagnostic) => diagnostic.code === "PARSE_ERROR",
      ).length,
      errors: diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ).length,
      warnings: diagnostics.filter(
        (diagnostic) => diagnostic.severity === "warning",
      ).length,
    },
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

export async function analyzeProject(
  target: string,
  options: AnalyzeProjectOptions = {},
): Promise<ProjectAnalysis> {
  const startedAt = performance.now();
  const absoluteTarget = path.resolve(target);
  let targetStat: Awaited<ReturnType<typeof stat>>;

  try {
    targetStat = await stat(absoluteTarget);
  } catch {
    throw new Error(`Target does not exist: ${absoluteTarget}`);
  }

  const exclude = new Set([
    ...DEFAULT_EXCLUDED_DIRECTORIES,
    ...(options.exclude ?? []),
  ]);

  let root: string;
  let sourceFiles: string[];

  if (targetStat.isFile()) {
    if (!isSourceFile(absoluteTarget)) {
      throw new Error(`Target is not a supported source file: ${absoluteTarget}`);
    }
    root = path.dirname(absoluteTarget);
    sourceFiles = [absoluteTarget];
  } else if (targetStat.isDirectory()) {
    root = absoluteTarget;
    sourceFiles = await collectSourceFiles(root, exclude);
  } else {
    throw new Error(`Target is not a file or directory: ${absoluteTarget}`);
  }

  const files = await mapWithConcurrency(
    sourceFiles,
    32,
    (filePath) => analyzeFile(filePath, root),
  );
  files.sort((left, right) => left.path.localeCompare(right.path));

  return finalizeAnalysis(root, files, startedAt);
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index]!);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

import { parse, type ParserPlugin } from "@babel/parser";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EXCLUDED_DIRECTORIES } from "./analyzer";

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

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

const MUTATING_METHODS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const COMPLEXITY_NODES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
]);

type AstNode = {
  type: string;
  start?: unknown;
  end?: unknown;
  loc?: unknown;
  [key: string]: unknown;
};

type AstFile = AstNode & {
  program: AstNode & { body: AstNode[] };
};

export type CodeHealthIssueType =
  | "event-listener-leak"
  | "timer-leak"
  | "use-effect-cleanup"
  | "global-object"
  | "state-mutation"
  | "missing-dependencies"
  | "infinite-render"
  | "dom-reference"
  | "component-re-render"
  | "high-complexity-function"
  | "expensive-jsx-operation"
  | "bundle-size-issue";

export type CodeHealthSeverity = "high" | "medium" | "low";

export interface CodeHealthIssue {
  type: CodeHealthIssueType;
  severity: CodeHealthSeverity;
  file: string;
  absolutePath: string;
  line?: number;
  code: string;
  message: string;
  suggestion?: string;
}

export interface CodeHealthDiagnostic {
  code: "READ_ERROR" | "PARSE_ERROR";
  severity: "error";
  file: string;
  line?: number;
  message: string;
}

export interface CodeHealthFileAnalysis {
  absolutePath: string;
  path: string;
  issues: CodeHealthIssue[];
  diagnostics: CodeHealthDiagnostic[];
}

export interface CodeHealthTotals {
  files: number;
  issues: number;
  high: number;
  medium: number;
  low: number;
  parseErrors: number;
  readErrors: number;
}

export interface CodeHealthAnalysis {
  root: string;
  files: CodeHealthFileAnalysis[];
  issues: CodeHealthIssue[];
  diagnostics: CodeHealthDiagnostic[];
  totals: CodeHealthTotals;
  durationMs: number;
}

export interface CodeHealthProgress {
  completed: number;
  total: number;
  file: string;
}

export interface AnalyzeCodeHealthOptions {
  exclude?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: CodeHealthProgress) => void;
}

interface IssueContext {
  absolutePath: string;
  relativePath: string;
  source: string;
  lines: string[];
}

interface CallDetails {
  node: AstNode;
  ancestors: AstNode[];
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function parserPlugins(filePath: string): ParserPlugin[] {
  const plugins: ParserPlugin[] = ["jsx", "decorators-legacy"];
  if (/\.(?:ts|tsx|mts|cts)$/i.test(filePath)) {
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

function nodeLine(node: AstNode): number | undefined {
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

function nodeText(node: unknown, source: string): string {
  if (!isAstNode(node)) return "";
  if (typeof node.start !== "number" || typeof node.end !== "number") return "";
  return source.slice(node.start, node.end);
}

function nodeName(node: unknown): string | null {
  if (!isAstNode(node)) return null;
  if (node.type === "Identifier" || node.type === "PrivateName") {
    return typeof node.name === "string" ? node.name : null;
  }
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
    return typeof node.value === "string" || typeof node.value === "number"
      ? String(node.value)
      : null;
  }
  return null;
}

function memberPropertyName(node: unknown): string | null {
  if (!isAstNode(node) || !["MemberExpression", "OptionalMemberExpression"].includes(node.type)) {
    return null;
  }
  return nodeName(node.property);
}

function rootObjectName(node: unknown): string | null {
  if (!isAstNode(node)) return null;
  if (node.type === "Identifier") return nodeName(node);
  if (["MemberExpression", "OptionalMemberExpression"].includes(node.type)) {
    return rootObjectName(node.object);
  }
  return null;
}

function callArguments(node: AstNode): AstNode[] {
  return Array.isArray(node.arguments) ? node.arguments.filter(isAstNode) : [];
}

function isCall(node: AstNode): boolean {
  return node.type === "CallExpression" || node.type === "OptionalCallExpression";
}

function isFunction(node: AstNode): boolean {
  return FUNCTION_TYPES.has(node.type);
}

function walkAst(
  node: AstNode,
  visitor: (node: AstNode, ancestors: AstNode[]) => void,
  ancestors: AstNode[] = [],
): void {
  visitor(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra", "comments", "tokens", "errors"].includes(key)) continue;
    if (isAstNode(value)) {
      walkAst(value, visitor, nextAncestors);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) walkAst(item, visitor, nextAncestors);
      }
    }
  }
}

function walkFunctionBody(
  root: AstNode,
  visitor: (node: AstNode, ancestors: AstNode[]) => void,
): void {
  const visit = (node: AstNode, ancestors: AstNode[]): void => {
    visitor(node, ancestors);
    const nextAncestors = [...ancestors, node];
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens", "errors"].includes(key)) continue;
      const children = isAstNode(value) ? [value] : Array.isArray(value) ? value.filter(isAstNode) : [];
      for (const child of children) {
        if (child !== root && isFunction(child)) continue;
        visit(child, nextAncestors);
      }
    }
  };
  visit(root, []);
}

function nearestScope(ancestors: AstNode[], program: AstNode): AstNode {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!;
    if (isFunction(ancestor)) return ancestor;
  }
  return program;
}

function callsWithin(scope: AstNode): CallDetails[] {
  const calls: CallDetails[] = [];
  walkAst(scope, (node, ancestors) => {
    if (isCall(node)) calls.push({ node, ancestors });
  });
  return calls;
}

function isNamedCall(node: AstNode, name: string): boolean {
  if (!isCall(node) || !isAstNode(node.callee)) return false;
  return nodeName(node.callee) === name || memberPropertyName(node.callee) === name;
}

function isHookCall(node: AstNode, name: string): boolean {
  if (!isCall(node) || !isAstNode(node.callee)) return false;
  if (nodeName(node.callee) === name) return true;
  return rootObjectName(node.callee) === "React" && memberPropertyName(node.callee) === name;
}

function issue(
  context: IssueContext,
  node: AstNode,
  type: CodeHealthIssueType,
  severity: CodeHealthSeverity,
  message: string,
  suggestion?: string,
): CodeHealthIssue {
  const line = nodeLine(node);
  return {
    type,
    severity,
    file: context.relativePath,
    absolutePath: context.absolutePath,
    line,
    code: line ? (context.lines[line - 1]?.trim() ?? "") : nodeText(node, context.source).trim(),
    message,
    suggestion,
  };
}

function sameExpression(left: unknown, right: unknown, source: string): boolean {
  const leftText = nodeText(left, source).replace(/\s+/g, "");
  const rightText = nodeText(right, source).replace(/\s+/g, "");
  return leftText.length > 0 && leftText === rightText;
}

function bindingForCall(node: AstNode, ancestors: AstNode[]): AstNode | null {
  const parent = ancestors.at(-1);
  if (!parent) return null;
  if (parent.type === "VariableDeclarator" && parent.init === node && isAstNode(parent.id)) return parent.id;
  if (parent.type === "AssignmentExpression" && parent.right === node && isAstNode(parent.left)) return parent.left;
  return null;
}

function hasEventListenerCleanup(call: AstNode, scope: AstNode, source: string): boolean {
  const callee = isAstNode(call.callee) ? call.callee : null;
  if (!callee || memberPropertyName(callee) !== "addEventListener") return true;
  const object = callee.object;
  const [event, handler] = callArguments(call);
  if (!event || !handler) return false;

  return callsWithin(scope).some(({ node }) => {
    const candidateCallee = isAstNode(node.callee) ? node.callee : null;
    if (!candidateCallee || memberPropertyName(candidateCallee) !== "removeEventListener") return false;
    const [candidateEvent, candidateHandler] = callArguments(node);
    return (
      sameExpression(object, candidateCallee.object, source) &&
      sameExpression(event, candidateEvent, source) &&
      sameExpression(handler, candidateHandler, source)
    );
  });
}

function hasTimerCleanup(
  call: AstNode,
  ancestors: AstNode[],
  scope: AstNode,
  source: string,
): boolean {
  const binding = bindingForCall(call, ancestors);
  if (!binding) return false;
  const clearName = isNamedCall(call, "setInterval") ? "clearInterval" : "clearTimeout";
  return callsWithin(scope).some(({ node }) => {
    if (!isNamedCall(node, clearName)) return false;
    const [candidate] = callArguments(node);
    return sameExpression(binding, candidate, source);
  });
}

function callbackReturnsCleanup(callback: AstNode): boolean {
  if (!isFunction(callback)) return false;
  if (isAstNode(callback.body) && (isFunction(callback.body) || callback.body.type === "Identifier")) return true;
  let found = false;
  walkFunctionBody(callback, (node) => {
    if (
      node.type === "ReturnStatement" &&
      isAstNode(node.argument) &&
      (isFunction(node.argument) || node.argument.type === "Identifier")
    ) {
      found = true;
    }
  });
  return found;
}

function callbackUsesResource(callback: AstNode): boolean {
  let found = false;
  walkFunctionBody(callback, (node) => {
    if (
      (isCall(node) &&
        (isNamedCall(node, "addEventListener") ||
          isNamedCall(node, "setTimeout") ||
          isNamedCall(node, "setInterval") ||
          isNamedCall(node, "requestAnimationFrame") ||
          isNamedCall(node, "subscribe") ||
          isNamedCall(node, "on"))) ||
      (node.type === "NewExpression" &&
        (nodeName(node.callee) === "WebSocket" || nodeName(node.callee) === "EventSource"))
    ) {
      found = true;
    }
  });
  return found;
}

function isStateName(name: string | null): boolean {
  return Boolean(name && /(?:^state$|state$)/i.test(name));
}

function isUnstableDependency(node: AstNode): boolean {
  return [
    "ObjectExpression",
    "ArrayExpression",
    "NewExpression",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node.type);
}

function functionName(node: AstNode, ancestors: AstNode[]): string | null {
  const ownName = nodeName(node.id);
  if (ownName) return ownName;
  const parent = ancestors.at(-1);
  if (parent?.type === "VariableDeclarator" && parent.init === node) return nodeName(parent.id);
  if (parent?.type === "AssignmentExpression" && parent.right === node) {
    return nodeName(parent.left) ?? memberPropertyName(parent.left);
  }
  return null;
}

function isMemoizedFunction(ancestors: AstNode[]): boolean {
  const parent = ancestors.at(-1);
  if (!parent || !isCall(parent) || !isAstNode(parent.callee)) return false;
  return nodeName(parent.callee) === "memo" || memberPropertyName(parent.callee) === "memo";
}

function containsJsx(node: AstNode): boolean {
  let found = false;
  walkFunctionBody(node, (candidate) => {
    if (candidate.type === "JSXElement" || candidate.type === "JSXFragment") found = true;
  });
  return found;
}

function functionComplexity(node: AstNode): number {
  let complexity = 1;
  walkFunctionBody(node, (candidate) => {
    if (candidate === node) return;
    if (COMPLEXITY_NODES.has(candidate.type)) complexity += 1;
    if (candidate.type === "SwitchCase" && candidate.test) complexity += 1;
    if (
      candidate.type === "LogicalExpression" &&
      (candidate.operator === "&&" || candidate.operator === "||" || candidate.operator === "??")
    ) {
      complexity += 1;
    }
  });
  return complexity;
}

function analyzeAst(ast: AstFile, context: IssueContext): CodeHealthIssue[] {
  const issues: CodeHealthIssue[] = [];
  const program = ast.program;
  const isTestFile = /(?:^|\/)(?:__tests__|__mocks__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(
    context.relativePath,
  );

  walkAst(program, (node, ancestors) => {
    if (!isTestFile && isCall(node) && isNamedCall(node, "addEventListener")) {
      const scope = nearestScope(ancestors, program);
      if (!hasEventListenerCleanup(node, scope, context.source)) {
        issues.push(
          issue(
            context,
            node,
            "event-listener-leak",
            "high",
            "Event listener has no matching removal in its containing scope.",
            "Return or invoke removeEventListener with the same target, event, and handler.",
          ),
        );
      }
    }

    if (
      !isTestFile &&
      isCall(node) &&
      (isNamedCall(node, "setTimeout") || isNamedCall(node, "setInterval"))
    ) {
      const scope = nearestScope(ancestors, program);
      if (!hasTimerCleanup(node, ancestors, scope, context.source)) {
        issues.push(
          issue(
            context,
            node,
            "timer-leak",
            "high",
            `${isNamedCall(node, "setInterval") ? "Interval" : "Timeout"} has no matching cleanup.`,
            `Store the timer handle and call ${isNamedCall(node, "setInterval") ? "clearInterval" : "clearTimeout"} during cleanup.`,
          ),
        );
      }
    }

    if (isCall(node) && isHookCall(node, "useEffect")) {
      const args = callArguments(node);
      const callback = args[0];
      const dependencies = args[1];
      if (!dependencies) {
        issues.push(
          issue(
            context,
            node,
            "missing-dependencies",
            "medium",
            "Effect has no dependency array and will run after every render.",
            "Add an explicit dependency array when repeated execution is not intended.",
          ),
        );
      } else if (dependencies.type === "ArrayExpression" && Array.isArray(dependencies.elements)) {
        const unstable = dependencies.elements.find((element) => isAstNode(element) && isUnstableDependency(element));
        if (isAstNode(unstable)) {
          issues.push(
            issue(
              context,
              unstable,
              "infinite-render",
              "high",
              "Effect dependency is recreated during every render.",
              "Memoize the dependency or move it outside the component.",
            ),
          );
        }
      }
      if (callback && callbackUsesResource(callback) && !callbackReturnsCleanup(callback)) {
        issues.push(
          issue(
            context,
            node,
            "use-effect-cleanup",
            "medium",
            "Effect creates a persistent resource without returning a cleanup function.",
            "Return a function that releases listeners, timers, or subscriptions.",
          ),
        );
      }
    }

    if (
      isCall(node) &&
      (isHookCall(node, "useMemo") || isHookCall(node, "useCallback")) &&
      callArguments(node).length < 2
    ) {
      const hookName = isHookCall(node, "useMemo") ? "useMemo" : "useCallback";
      issues.push(
        issue(
          context,
          node,
          "missing-dependencies",
          "medium",
          `${hookName} has no dependency array.`,
          "Add the values used by the callback to an explicit dependency array.",
        ),
      );
    }

    if (node.type === "AssignmentExpression" && isAstNode(node.left) && isAstNode(node.right)) {
      const globalName = rootObjectName(node.left);
      const constructorName = node.right.type === "NewExpression" ? nodeName(node.right.callee) : null;
      if (
        ["window", "global", "globalThis"].includes(globalName ?? "") &&
        (["ObjectExpression", "ArrayExpression"].includes(node.right.type) ||
          (constructorName !== null && ["Array", "Object", "Map", "Set"].includes(constructorName)))
      ) {
        issues.push(
          issue(
            context,
            node,
            "global-object",
            "medium",
            "Mutable object is retained on the global object.",
            "Keep mutable data in a scoped owner and release it when that owner is disposed.",
          ),
        );
      }
    }

    if (node.type === "AssignmentExpression" && isAstNode(node.left)) {
      const rootName = rootObjectName(node.left);
      if (isStateName(rootName)) {
        issues.push(
          issue(
            context,
            node,
            "state-mutation",
            "medium",
            "State is assigned to directly.",
            "Create a new value and update state through its setter.",
          ),
        );
      }
    }

    if (isCall(node) && isAstNode(node.callee)) {
      const method = memberPropertyName(node.callee);
      const rootName = rootObjectName(node.callee.object);
      const objectAssignTarget =
        rootObjectName(node.callee) === "Object" && method === "assign" ? rootObjectName(callArguments(node)[0]) : null;
      if ((method && MUTATING_METHODS.has(method) && isStateName(rootName)) || isStateName(objectAssignTarget)) {
        issues.push(
          issue(
            context,
            node,
            "state-mutation",
            "medium",
            "State is mutated in place.",
            "Copy the state value before changing it, then use the state setter.",
          ),
        );
      }
    }

    if (isCall(node) && isAstNode(node.callee)) {
      const domMethod = memberPropertyName(node.callee);
      const domRoot = rootObjectName(node.callee);
      if (
        (domRoot === "document" || domRoot === "window") &&
        domMethod &&
        /^(?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName)$/.test(domMethod)
      ) {
        issues.push(
          issue(
            context,
            node,
            "dom-reference",
            "low",
            "Direct DOM lookup can escape the component lifecycle.",
            "Prefer a ref and release any retained references during cleanup.",
          ),
        );
      }
    }

    if (isFunction(node)) {
      const name = functionName(node, ancestors);
      if (name && /^[A-Z]/.test(name) && containsJsx(node) && !isMemoizedFunction(ancestors)) {
        issues.push(
          issue(
            context,
            node,
            "component-re-render",
            "medium",
            `Component ${name} may re-render when its parent renders.`,
            "Measure first; memoize the component when stable props make it worthwhile.",
          ),
        );
      }
      const complexity = functionComplexity(node);
      if (complexity > 10) {
        issues.push(
          issue(
            context,
            node,
            "high-complexity-function",
            "medium",
            `Function has cyclomatic complexity ${complexity}.`,
            "Extract cohesive branches into smaller named functions.",
          ),
        );
      }
    }

    if (isCall(node) && isAstNode(node.callee)) {
      const method = memberPropertyName(node.callee);
      const insideJsx = ancestors.some((ancestor) => ancestor.type === "JSXExpressionContainer");
      if (insideJsx && method && ["map", "filter", "reduce"].includes(method)) {
        issues.push(
          issue(
            context,
            node,
            "expensive-jsx-operation",
            "medium",
            `${method}() runs while JSX is rendered.`,
            "Memoize expensive derived values when profiling shows repeated work.",
          ),
        );
      }
    }

    if (node.type === "ImportDeclaration" && isAstNode(node.source)) {
      const packageName = nodeName(node.source);
      if (packageName === "moment" || packageName === "moment-timezone") {
        issues.push(
          issue(
            context,
            node,
            "bundle-size-issue",
            "low",
            `Importing ${packageName} can add substantial bundle weight.`,
            "Consider Intl, date-fns, Day.js, or a narrower date utility.",
          ),
        );
      }
    }

    if (isCall(node) && nodeName(node.callee) === "require") {
      const packageName = nodeName(callArguments(node)[0]);
      if (packageName === "moment" || packageName === "moment-timezone") {
        issues.push(
          issue(
            context,
            node,
            "bundle-size-issue",
            "low",
            `Requiring ${packageName} can add substantial bundle weight.`,
            "Consider Intl, date-fns, Day.js, or a narrower date utility.",
          ),
        );
      }
    }
  });

  const unique = new Map<string, CodeHealthIssue>();
  for (const item of issues) {
    unique.set(`${item.type}\u0000${item.line ?? 0}\u0000${item.message}`, item);
  }
  return [...unique.values()].sort(
    (left, right) => (left.line ?? 0) - (right.line ?? 0) || left.type.localeCompare(right.type),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseErrorLine(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "loc" in error &&
    typeof error.loc === "object" &&
    error.loc !== null &&
    "line" in error.loc &&
    typeof error.loc.line === "number"
  ) {
    return error.loc.line;
  }
  return undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("Analysis aborted", "AbortError");
}

function relativePath(root: string, absolutePath: string): string {
  return (path.relative(root, absolutePath) || path.basename(absolutePath)).split(path.sep).join("/");
}

export function analyzeCodeHealthSource(
  source: string,
  filePath = "source.tsx",
  root = path.dirname(path.resolve(filePath)),
): CodeHealthFileAnalysis {
  const absolutePath = path.resolve(filePath);
  const file = relativePath(root, absolutePath);
  const diagnostics: CodeHealthDiagnostic[] = [];
  let ast: AstFile;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: parserPlugins(absolutePath),
      allowReturnOutsideFunction: true,
    }) as unknown as AstFile;
  } catch (error) {
    diagnostics.push({
      code: "PARSE_ERROR",
      severity: "error",
      file,
      line: parseErrorLine(error),
      message: `Unable to parse file: ${errorMessage(error)}`,
    });
    return { absolutePath, path: file, issues: [], diagnostics };
  }

  const context: IssueContext = {
    absolutePath,
    relativePath: file,
    source,
    lines: source.split(/\r?\n/),
  };
  return { absolutePath, path: file, issues: analyzeAst(ast, context), diagnostics };
}

async function analyzeFile(absolutePath: string, root: string): Promise<CodeHealthFileAnalysis> {
  let source: string;
  try {
    source = await Bun.file(absolutePath).text();
  } catch (error) {
    const file = relativePath(root, absolutePath);
    return {
      absolutePath,
      path: file,
      issues: [],
      diagnostics: [
        {
          code: "READ_ERROR",
          severity: "error",
          file,
          message: `Unable to read file: ${errorMessage(error)}`,
        },
      ],
    };
  }
  return analyzeCodeHealthSource(source, absolutePath, root);
}

function isSourceFile(fileName: string): boolean {
  if (/\.d\.(?:ts|mts|cts)$/i.test(fileName)) return false;
  return SOURCE_EXTENSIONS.some((extension) => fileName.toLowerCase().endsWith(extension));
}

async function collectSourceFiles(root: string, exclude: Set<string>, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    throwIfAborted(signal);
    const directory = directories.pop();
    if (!directory) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(absolutePath);
      else if (entry.isFile() && isSourceFile(entry.name)) files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function finalize(root: string, files: CodeHealthFileAnalysis[], startedAt: number): CodeHealthAnalysis {
  const issues = files.flatMap((file) => file.issues);
  const diagnostics = files.flatMap((file) => file.diagnostics);
  return {
    root,
    files,
    issues,
    diagnostics,
    totals: {
      files: files.length,
      issues: issues.length,
      high: issues.filter((item) => item.severity === "high").length,
      medium: issues.filter((item) => item.severity === "medium").length,
      low: issues.filter((item) => item.severity === "low").length,
      parseErrors: diagnostics.filter((item) => item.code === "PARSE_ERROR").length,
      readErrors: diagnostics.filter((item) => item.code === "READ_ERROR").length,
    },
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

export async function analyzeCodeHealth(
  target: string,
  options: AnalyzeCodeHealthOptions = {},
): Promise<CodeHealthAnalysis> {
  const startedAt = performance.now();
  const absoluteTarget = path.resolve(target);
  throwIfAborted(options.signal);
  const targetStats = await stat(absoluteTarget);
  const root = targetStats.isDirectory() ? absoluteTarget : path.dirname(absoluteTarget);
  const exclude = new Set([...DEFAULT_EXCLUDED_DIRECTORIES, ...(options.exclude ?? [])]);
  const sourceFiles = targetStats.isDirectory()
    ? await collectSourceFiles(absoluteTarget, exclude, options.signal)
    : isSourceFile(absoluteTarget)
      ? [absoluteTarget]
      : [];
  const files = new Array<CodeHealthFileAnalysis>(sourceFiles.length);
  let cursor = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      throwIfAborted(options.signal);
      const index = cursor;
      cursor += 1;
      if (index >= sourceFiles.length) return;
      const absolutePath = sourceFiles[index]!;
      files[index] = await analyzeFile(absolutePath, root);
      throwIfAborted(options.signal);
      completed += 1;
      options.onProgress?.({ completed, total: sourceFiles.length, file: relativePath(root, absolutePath) });
    }
  };

  const workerCount = Math.min(8, sourceFiles.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  throwIfAborted(options.signal);
  return finalize(root, files, startedAt);
}

export function codeHealthIssueLabel(type: CodeHealthIssueType): string {
  return type
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

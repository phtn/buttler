export {
  analyzeProject,
  DEFAULT_EXCLUDED_DIRECTORIES,
  type AnalysisTotals,
  type AnalyzeProjectOptions,
  type Diagnostic,
  type DiagnosticSeverity,
  type ExportKind,
  type ExportSymbol,
  type FileAnalysis,
  type ImportKind,
  type ImportSymbol,
  type ProjectAnalysis,
  type ReexportSymbol,
  type UnusedExport,
} from "./analyzer";

export {
  analyzeCodeHealth,
  analyzeCodeHealthSource,
  codeHealthIssueLabel,
  type AnalyzeCodeHealthOptions,
  type CodeHealthAnalysis,
  type CodeHealthDiagnostic,
  type CodeHealthFileAnalysis,
  type CodeHealthIssue,
  type CodeHealthIssueType,
  type CodeHealthProgress,
  type CodeHealthSeverity,
  type CodeHealthTotals,
} from "./code-health";

export {
  parseCliArgs,
  usage,
  VERSION,
  type CliOptions,
  type OutputMode,
} from "./cli";

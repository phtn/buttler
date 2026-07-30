import type { FileAnalysis, ProjectAnalysis } from '../core'

export interface TableColumn {
  header: string
  width: number
  align?: 'left' | 'right' | 'center'
}

export interface TableRow {
  [key: string]: string | number
}

const ANSI_PATTERN =
  // CSI, OSC, and single-character escape sequences.
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[^\dA-PR-TZcf-nq-uy=><~]|(?:\d{1,4}(?:[;:]\d{0,4})*))?\d*[A-PR-TZcf-nq-uy=><~])|(?:\][^\u0007]*(?:\u0007|\u001B\\)))/g

export function stripAnsiCodes(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

export function getVisualWidth(value: string): number {
  return Array.from(stripAnsiCodes(value)).length
}

export function truncateToVisualWidth(value: string, width: number): string {
  if (width <= 0) return ''
  if (getVisualWidth(value) <= width) return value
  if (width === 1) return '…'

  const characters = Array.from(stripAnsiCodes(value))
  return `${characters.slice(0, width - 1).join('')}…`
}

export function padToVisualWidth(value: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const text = truncateToVisualWidth(value, Math.max(0, width))
  const padding = Math.max(0, width - getVisualWidth(text))

  if (align === 'right') return `${' '.repeat(padding)}${text}`
  if (align === 'center') {
    const left = Math.floor(padding / 2)
    return `${' '.repeat(left)}${text}${' '.repeat(padding - left)}`
  }
  return `${text}${' '.repeat(padding)}`
}

export function createTableSeparator(columns: TableColumn[]): string {
  return columns.map((column) => '⎺'.repeat(Math.max(1, column.width))).join(' ')
}

export function formatTable(columns: TableColumn[], rows: TableRow[]): string {
  if (columns.length === 0) return ''

  const header = columns
    .map((column) => padToVisualWidth(column.header, Math.max(1, column.width), column.align ?? 'left'))
    .join(' ')

  const body = rows.map((row) => formatTableRow(columns, row))

  return [header, createTableSeparator(columns), ...body].join('\n')
}

export function formatTableRow(columns: TableColumn[], row: TableRow): string {
  return columns
    .map((column) =>
      padToVisualWidth(String(row[column.header] ?? ''), Math.max(1, column.width), column.align ?? 'left')
    )
    .join(' ')
}

export function analysisColumns(fileWidth = 35): TableColumn[] {
  return [
    { header: 'File', width: Math.max(12, fileWidth) },
    { header: 'Imports', width: 9, align: 'center' },
    { header: 'Exports', width: 9, align: 'center' }
  ]
}

export function analysisFileWidth(availableWidth: number, minimum = 18): number {
  // Two nine-character numeric columns plus the two inter-column spaces.
  return Math.max(minimum, availableWidth - 20)
}

export function analysisRow(file: FileAnalysis): TableRow {
  return {
    File: file.path,
    Imports: file.imports.length,
    Exports: file.exports.length
  }
}

export function unusedExportsRow(analysis: ProjectAnalysis): TableRow {
  return {
    File: 'Unused exports',
    Imports: 0,
    Exports: analysis.unusedExports.length
  }
}

export function formatAnalysisTable(analysis: ProjectAnalysis, fileWidth?: number): string {
  const longestPath = analysis.files.reduce((longest, file) => Math.max(longest, getVisualWidth(file.path)), 0)
  const resolvedFileWidth = fileWidth ?? Math.max(35, Math.min(70, longestPath))
  const rows = [...analysis.files.map(analysisRow), unusedExportsRow(analysis)]

  return formatTable(analysisColumns(resolvedFileWidth), rows)
}

export function formatPlainReport(analysis: ProjectAnalysis): string {
  const table = formatAnalysisTable(analysis)
  const totals = analysis.totals
  const summary = [
    `${totals.files} files`,
    `${totals.imports} imports`,
    `${totals.exports} exports`,
    `${totals.unusedExports} unused`,
    `${totals.unresolvedImports} unresolved`,
    `${totals.parseErrors} parse errors`,
    `${analysis.durationMs}ms`
  ].join(' · ')

  return `${table}\n\n${summary}`
}

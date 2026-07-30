import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  createCliRenderer,
  fg,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type TextChunk
} from '@opentui/core'
import path from 'node:path'
import {
  analyzeProject,
  type AnalyzeProjectOptions,
  type Diagnostic,
  type FileAnalysis,
  type ProjectAnalysis
} from '../core'
import {
  analysisColumns,
  analysisFileWidth,
  analysisRow,
  createTableSeparator,
  formatTableRow,
  padToVisualWidth,
  unusedExportsRow
} from './table'
import { theme, type ThemeColor } from './theme'

type DashboardRow = { kind: 'file'; file: FileAnalysis } | { kind: 'unused'; analysis: ProjectAnalysis }

type StatusTone = 'normal' | 'success' | 'warning' | 'error'

export interface DashboardOptions {
  onQuit?: () => void
  onRescan?: () => Promise<ProjectAnalysis>
}

export interface DiagnosisDashboard {
  readonly root: BoxRenderable
  readonly fileList: SelectRenderable
  readonly filterInput: InputRenderable
  setAnalysis(analysis: ProjectAnalysis): void
  setStatus(message: string, tone?: StatusTone): void
  dispose(): void
}

export interface RunInteractiveOptions extends AnalyzeProjectOptions {}

function statusColor(tone: StatusTone): ThemeColor {
  switch (tone) {
    case 'success':
      return theme.success
    case 'warning':
      return theme.warning
    case 'error':
      return theme.error
    case 'normal':
    default:
      return theme.textMuted
  }
}

function pushLine(chunks: TextChunk[], value = '', color: ThemeColor = theme.text): void {
  chunks.push(fg(color)(`${value}\n`))
}

function detailForFile(file: FileAnalysis): StyledText {
  const chunks: TextChunk[] = []
  chunks.push(bold(fg(theme.accent)(file.path)))
  pushLine(chunks)
  pushLine(
    chunks,
    `${file.imports.length} imports  ·  ${file.exports.length} exports  ·  ${file.diagnostics.length} diagnostics`,
    theme.textMuted
  )
  pushLine(chunks)

  chunks.push(bold(fg(theme.info)('IMPORTS')))
  pushLine(chunks)
  if (file.imports.length === 0) {
    pushLine(chunks, '  None', theme.textMuted)
  } else {
    for (const imported of file.imports) {
      const alias = imported.local && imported.local !== imported.imported ? ` as ${imported.local}` : ''
      const typeLabel = imported.typeOnly ? 'type ' : ''
      pushLine(chunks, `  ↓ ${typeLabel}${imported.imported}${alias}`, theme.text)
      pushLine(chunks, `    from ${imported.source}`, theme.textMuted)
    }
  }

  pushLine(chunks)
  chunks.push(bold(fg(theme.accent)('EXPORTS')))
  pushLine(chunks)
  if (file.exports.length === 0) {
    pushLine(chunks, '  None', theme.textMuted)
  } else {
    for (const exported of file.exports) {
      const typeLabel = exported.typeOnly ? 'type ' : ''
      const source = exported.source ? `  from ${exported.source}` : ''
      pushLine(chunks, `  ↑ ${typeLabel}${exported.name}${source}`)
    }
  }

  pushLine(chunks)
  chunks.push(bold(fg(theme.warning)('DIAGNOSTICS')))
  pushLine(chunks)
  if (file.diagnostics.length === 0) {
    pushLine(chunks, '  ✓ No issues found', theme.success)
  } else {
    for (const diagnostic of file.diagnostics) {
      const marker = diagnostic.severity === 'error' ? '×' : '!'
      const color = diagnostic.severity === 'error' ? theme.error : theme.warning
      const location = diagnostic.line ? `:${diagnostic.line}` : ''
      pushLine(chunks, `  ${marker} ${diagnostic.code}${location}`, color)
      pushLine(chunks, `    ${diagnostic.message}`, theme.textMuted)
    }
  }

  return new StyledText(chunks)
}

function detailForUnused(analysis: ProjectAnalysis): StyledText {
  const chunks: TextChunk[] = []
  chunks.push(bold(fg(theme.warning)('UNUSED EXPORTS')))
  pushLine(chunks)
  pushLine(
    chunks,
    `${analysis.unusedExports.length} export candidates are not imported by another scanned file.`,
    theme.textMuted
  )
  pushLine(chunks)

  if (analysis.unusedExports.length === 0) {
    pushLine(chunks, '✓ Every export is referenced.', theme.success)
  } else {
    for (const unused of analysis.unusedExports) {
      const location = unused.line ? `:${unused.line}` : ''
      const typeLabel = unused.typeOnly ? 'type ' : ''
      pushLine(chunks, `! ${unused.file}${location}`, theme.warning)
      pushLine(chunks, `  ${typeLabel}${unused.name}`, theme.text)
    }
  }

  pushLine(chunks)
  pushLine(
    chunks,
    'These are static-analysis candidates; runtime and external consumers cannot be inferred.',
    theme.textMuted
  )

  return new StyledText(chunks)
}

function noMatchesDetail(filter: string): StyledText {
  return new StyledText([
    bold(fg(theme.warning)('NO MATCHES')),
    fg(theme.textMuted)(`\n\nNo files match “${filter}”. Press Esc to clear the filter.`)
  ])
}

function summaryText(analysis: ProjectAnalysis): StyledText {
  const totals = analysis.totals
  const issueColor = totals.errors > 0 ? theme.error : totals.warnings > 0 ? theme.warning : theme.success

  return new StyledText([
    fg(theme.text)(`${totals.files} 🅵`),
    fg(theme.border)('  '),
    fg(theme.text)(`${totals.imports} 🅸`),
    fg(theme.border)('  '),
    fg(theme.text)(`${totals.exports} 🅴`),
    fg(theme.border)('  '),
    fg(issueColor)(`${totals.errors + totals.warnings} 🅳`),
    fg(theme.border)('  '),
    fg(theme.textMuted)(`${analysis.durationMs}ms`)
  ])
}

function rowsFor(analysis: ProjectAnalysis, filterValue: string): DashboardRow[] {
  const query = filterValue.trim().toLocaleLowerCase()
  const rows: DashboardRow[] = analysis.files
    .filter((file) => file.path.toLocaleLowerCase().includes(query))
    .map((file) => ({ kind: 'file' as const, file }))

  if (!query || 'unused exports'.includes(query)) {
    rows.push({ kind: 'unused', analysis })
  }

  return rows
}

function displayName(row: DashboardRow, analysis: ProjectAnalysis, availableWidth: number): string {
  const fileWidth = analysisFileWidth(availableWidth)
  const columns = analysisColumns(fileWidth)
  const tableRow = row.kind === 'file' ? analysisRow(row.file) : unusedExportsRow(analysis)
  return formatTableRow(columns, tableRow)
}

function tableHeading(availableWidth: number): string {
  const columns = analysisColumns(analysisFileWidth(availableWidth))
  const header = columns
    .map((column) => padToVisualWidth(column.header, column.width, column.align ?? 'left'))
    .join(' ')
  return `${header}\n${createTableSeparator(columns)}`
}

export function createDiagnosisDashboard(
  renderer: CliRenderer,
  initialAnalysis: ProjectAnalysis,
  options: DashboardOptions = {}
): DiagnosisDashboard {
  let analysis = initialAnalysis
  const project = analysis.root.split('/').pop() ?? ''
  let filteredRows: DashboardRow[] = []
  let scanning = false
  let disposed = false

  const root = new BoxRenderable(renderer, {
    id: 'app',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: theme.background
  })

  const header = new BoxRenderable(renderer, {
    id: 'header',
    width: '100%',
    height: 3,
    paddingX: 1,
    flexDirection: 'column',
    backgroundColor: theme.surfaceRaised
  })
  const summary = new TextRenderable(renderer, {
    id: 'summary',
    height: 1,
    content: summaryText(analysis)
  })
  const brand = new TextRenderable(renderer, {
    id: 'brand',
    height: 1,
    content: new StyledText([
      fg(theme.accent)('🅿 '),
      fg(theme.border)('⧸'),
      bold(fg(theme.textMuted)(project)),
      fg(theme.border)('  ▸  '),
      bold(fg(theme.text)('⦵')),
      fg(theme.textMuted)(' Morti'),
      fg(theme.border)('  ▸  ')
    ])
  })

  const filterRow = new BoxRenderable(renderer, {
    id: 'filter-row',
    width: '100%',
    height: 1,
    flexDirection: 'row'
  })
  const filterLabel = new TextRenderable(renderer, {
    id: 'filter-label',
    width: 4,
    height: 1,
    content: new StyledText([fg(theme.border)('❲'), fg(theme.info)('⧸'), fg(theme.border)('❳')])
  })

  const filterInput = new InputRenderable(renderer, {
    id: 'filter',
    flexGrow: 1,
    placeholder: 'search files',
    textColor: theme.text,
    focusedTextColor: theme.text,
    backgroundColor: theme.surfaceRaised,
    focusedBackgroundColor: theme.surface,
    cursorColor: theme.accent
  })
  filterRow.add(filterLabel)
  filterRow.add(filterInput)
  header.add(brand)
  header.add(summary)
  header.add(filterRow)

  const main = new BoxRenderable(renderer, {
    id: 'main',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row'
  })

  const filePanel = new BoxRenderable(renderer, {
    id: 'file-panel',
    width: '62%',
    height: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    title: ``,
    titleColor: theme.textMuted,
    backgroundColor: theme.surface
  })
  const tableHeader = new TextRenderable(renderer, {
    id: 'table-header',
    width: '100%',
    height: 2,
    fg: theme.textMuted,
    content: ''
  })
  const fileList = new SelectRenderable(renderer, {
    id: 'file-list',
    width: '100%',
    flexGrow: 1,
    options: [],
    showDescription: false,
    showScrollIndicator: true,
    showSelectionIndicator: true,
    wrapSelection: true,
    backgroundColor: theme.surface,
    textColor: theme.textMuted,
    focusedBackgroundColor: theme.surface,
    focusedTextColor: theme.text,
    selectedBackgroundColor: theme.accentStrong,
    selectedTextColor: theme.background
  })
  filePanel.add(tableHeader)
  filePanel.add(fileList)

  const detailPanel = new BoxRenderable(renderer, {
    id: 'detail-panel',
    width: '38%',
    height: '100%',
    border: true,
    borderStyle: 'single',
    borderColor: theme.border,
    title: ' DETAILS ',
    titleColor: theme.textMuted,
    backgroundColor: theme.surface
  })
  const detailScroll = new ScrollBoxRenderable(renderer, {
    id: 'detail-scroll',
    width: '100%',
    height: '100%',
    scrollY: true,
    paddingX: 1,
    backgroundColor: theme.surface,
    viewportCulling: true
  })
  const detail = new TextRenderable(renderer, {
    id: 'detail',
    width: '100%',
    height: 'auto',
    wrapMode: 'word',
    content: '',
    fg: theme.text
  })
  detailScroll.add(detail)
  detailPanel.add(detailScroll)
  main.add(filePanel)
  main.add(detailPanel)

  const footer = new BoxRenderable(renderer, {
    id: 'footer',
    width: '100%',
    height: 1,
    paddingX: 1,
    flexDirection: 'row',
    backgroundColor: theme.surfaceRaised
  })
  const shortcuts = new TextRenderable(renderer, {
    id: 'shortcuts',
    flexGrow: 1,
    height: 1,

    content: new StyledText([
      fg(theme.text)(' ⛖ '),
      fg(theme.textMuted)('navigate   '),
      fg(theme.text)(' / '),
      fg(theme.textMuted)('filter   '),
      fg(theme.text)(' r '),
      fg(theme.textMuted)('rescan   '),
      fg(theme.text)(' q '),
      fg(theme.textMuted)('quit')
    ])
  })
  const status = new TextRenderable(renderer, {
    id: 'status',
    height: 1,
    content: new StyledText([fg(theme.success)('Ready')])
  })
  footer.add(shortcuts)
  footer.add(status)

  root.add(header)
  root.add(main)
  root.add(footer)
  renderer.root.add(root)

  const availableTableWidth = (): number => {
    const wide = renderer.terminalWidth >= 96
    const panelWidth = wide ? Math.floor(renderer.terminalWidth * 0.62) : renderer.terminalWidth
    // Borders, selection marker, and a small safety gutter.
    return Math.max(38, panelWidth - 6)
  }

  const updateDetail = (row: DashboardRow | undefined): void => {
    if (!row) {
      detail.content = noMatchesDetail(filterInput.value)
      detailScroll.scrollTo(0)
      return
    }
    detail.content = row.kind === 'file' ? detailForFile(row.file) : detailForUnused(row.analysis)
    detailScroll.scrollTo(0)
  }

  const refreshRows = (preferredPath?: string): void => {
    const selected = fileList.getSelectedOption()?.value as DashboardRow | undefined
    const rememberedPath = preferredPath ?? (selected?.kind === 'file' ? selected.file.path : '')
    filteredRows = rowsFor(analysis, filterInput.value)
    const width = availableTableWidth()
    tableHeader.content = tableHeading(width)
    fileList.options = filteredRows.map((row) => ({
      name: displayName(row, analysis, width),
      description: '',
      value: row
    }))

    if (filteredRows.length === 0) {
      updateDetail(undefined)
      return
    }

    const rememberedIndex = filteredRows.findIndex((row) => row.kind === 'file' && row.file.path === rememberedPath)
    fileList.setSelectedIndex(Math.max(0, rememberedIndex))
    updateDetail(filteredRows[fileList.getSelectedIndex()])
  }

  const updateLayout = (): void => {
    const wide = renderer.terminalWidth >= 96
    main.flexDirection = wide ? 'row' : 'column'
    filePanel.width = wide ? '62%' : '100%'
    filePanel.height = wide ? '100%' : '56%'
    detailPanel.width = wide ? '38%' : '100%'
    detailPanel.height = wide ? '100%' : '44%'
    refreshRows()
  }

  const setStatus = (message: string, tone: StatusTone = 'normal'): void => {
    status.content = new StyledText([fg(statusColor(tone))(message)])
  }

  const setAnalysis = (nextAnalysis: ProjectAnalysis): void => {
    analysis = nextAnalysis
    summary.content = summaryText(analysis)
    filePanel.title = ` FILES · ${analysis.files.length} `
    refreshRows()
  }

  const rescan = async (): Promise<void> => {
    if (!options.onRescan || scanning) return
    scanning = true
    setStatus('Scanning…', 'warning')
    try {
      setAnalysis(await options.onRescan())
      setStatus('Scan complete', 'success')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      scanning = false
    }
  }

  const consume = (key: KeyEvent): void => {
    key.preventDefault()
    key.stopPropagation()
  }

  const keyHandler = (key: KeyEvent): void => {
    const filterFocused = renderer.currentFocusedRenderable === filterInput

    if (filterFocused) {
      if (key.name === 'escape') {
        filterInput.value = ''
        refreshRows()
        fileList.focus()
        consume(key)
      } else if (key.name === 'tab') {
        fileList.focus()
        consume(key)
      }
      return
    }

    if ((key.ctrl && key.name === 'c') || key.name === 'q') {
      consume(key)
      options.onQuit?.()
      return
    }

    if (key.name === '/' || key.sequence === '/') {
      filterInput.focus()
      consume(key)
      return
    }

    if (key.name === 'tab') {
      filterInput.focus()
      consume(key)
      return
    }

    if (key.name === 'r') {
      consume(key)
      void rescan()
    }
  }

  const selectionHandler = (index: number, option: { value?: unknown } | null): void => {
    const row = option?.value as DashboardRow | undefined
    updateDetail(row ?? filteredRows[index])
  }

  const filterHandler = (): void => refreshRows()
  const filterSubmitHandler = (): void => fileList.focus()
  const resizeHandler = (): void => updateLayout()

  renderer.keyInput.on('keypress', keyHandler)
  renderer.on(CliRenderEvents.RESIZE, resizeHandler)
  fileList.on(SelectRenderableEvents.SELECTION_CHANGED, selectionHandler)
  filterInput.on(InputRenderableEvents.INPUT, filterHandler)
  filterInput.on(InputRenderableEvents.ENTER, filterSubmitHandler)

  updateLayout()
  fileList.focus()
  setStatus(
    analysis.totals.errors > 0
      ? `${analysis.totals.errors} errors`
      : analysis.totals.warnings > 0
        ? `${analysis.totals.warnings} warnings`
        : 'Clean',
    analysis.totals.errors > 0 ? 'error' : analysis.totals.warnings > 0 ? 'warning' : 'success'
  )

  return {
    root,
    fileList,
    filterInput,
    setAnalysis,
    setStatus,
    dispose() {
      if (disposed) return
      disposed = true
      renderer.keyInput.off('keypress', keyHandler)
      renderer.off(CliRenderEvents.RESIZE, resizeHandler)
      fileList.off(SelectRenderableEvents.SELECTION_CHANGED, selectionHandler)
      filterInput.off(InputRenderableEvents.INPUT, filterHandler)
      filterInput.off(InputRenderableEvents.ENTER, filterSubmitHandler)
      if (root.parent) renderer.root.remove(root)
      root.destroyRecursively()
    }
  }
}

export async function runInteractiveDiagnosis(target: string, options: RunInteractiveOptions = {}): Promise<void> {
  const initialAnalysis = await analyzeProject(target, options)
  let finish: (() => void) | undefined
  const completed = new Promise<void>((resolve) => {
    finish = resolve
  })

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    clearOnShutdown: true,
    consoleMode: 'disabled',
    backgroundColor: theme.background,
    onDestroy: () => finish?.()
  })

  const dashboard = createDiagnosisDashboard(renderer, initialAnalysis, {
    onQuit: () => renderer.destroy(),
    onRescan: () => analyzeProject(target, options)
  })

  try {
    await completed
  } finally {
    dashboard.dispose()
    if (!renderer.isDestroyed) renderer.destroy()
  }
}

export function formatDiagnosticLocation(diagnostic: Diagnostic): string {
  return `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''}`
}

export function displayProjectName(analysis: ProjectAnalysis): string {
  return path.basename(analysis.root) || analysis.root
}

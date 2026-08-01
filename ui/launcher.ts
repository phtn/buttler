import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  createCliRenderer,
  fg,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type KeyEvent
} from '@opentui/core'
import path from 'node:path'
import {
  analyzeCodeHealth,
  analyzeProject,
  loadAlacrittyConfig,
  loadHerdrConfig,
  loadKittyConfig,
  VERSION,
  type AnalyzeProjectOptions
} from '../core'
import { createAlacrittyDashboard } from './alacritty-dashboard'
import { createAnalyzerDashboard } from './analyzer-dashboard'
import { createDiagnosisDashboard } from './dashboard'
import { createHerdrDashboard } from './herdr-dashboard'
import { createKittyDashboard } from './kitty-dashboard'
import { createMemoryDashboard } from './memory-dashboard'
import { getVisualWidth, padToVisualWidth, truncateToVisualWidth } from './table'
import { theme, type ThemeColor } from './theme'

const TOOL_TILE_WIDTH = 22
const TOOL_TILE_HEIGHT = 7
const TOOL_TILE_GAP = 2
const GRID_PADDING_X = 2

type LauncherTone = 'normal' | 'active' | 'error'

export const DEVELOPER_TOOLS_CATEGORY = 'Developer Tools'
export const TERMINAL_CONFIG_CATEGORY = 'Terminal Configs'

export interface ToolDefinition {
  id: string
  name: string
  glyph: string
  description: string
  category?: string
}

export interface ToolLauncherOptions {
  projectName?: string
  initialToolId?: string
  onLaunch?: (tool: ToolDefinition) => void | Promise<void>
  onQuit?: () => void
}

export interface ToolLauncher {
  readonly root: BoxRenderable
  readonly selectedIndex: number
  readonly selectedTool: ToolDefinition
  setStatus(message: string, tone?: LauncherTone): void
  dispose(): void
}

export const MORTI_TOOL: ToolDefinition = {
  id: 'morti',
  name: 'morti',
  glyph: '⦵',
  description: 'clear dead code',
  category: DEVELOPER_TOOLS_CATEGORY
}

export const ANALYZER_TOOL: ToolDefinition = {
  id: 'analyzer',
  name: 'analyzer',
  glyph: '⌁',
  description: 'find risky patterns',
  category: DEVELOPER_TOOLS_CATEGORY
}

export const MEMORY_TOOL: ToolDefinition = {
  id: 'memory',
  name: 'memory',
  glyph: '∿',
  description: 'watch runtime growth',
  category: DEVELOPER_TOOLS_CATEGORY
}

export const KITTY_TOOL: ToolDefinition = {
  id: 'kitty',
  name: 'kitty',
  glyph: 'K',
  description: 'kitty.conf',
  category: TERMINAL_CONFIG_CATEGORY
}

export const ALACRITTY_TOOL: ToolDefinition = {
  id: 'alacritty',
  name: 'alacritty',
  glyph: 'A',
  description: 'alacritty.toml',
  category: TERMINAL_CONFIG_CATEGORY
}

export const HERDR_TOOL: ToolDefinition = {
  id: 'herdr',
  name: 'herdr',
  glyph: 'H',
  description: 'config.toml',
  category: TERMINAL_CONFIG_CATEGORY
}

function statusColor(tone: LauncherTone): ThemeColor {
  switch (tone) {
    case 'active':
      return theme.accent
    case 'error':
      return theme.error
    case 'normal':
    default:
      return theme.textMuted
  }
}

function centeredLines(value: string, width: number): string {
  return value
    .split('\n')
    .map((line) => padToVisualWidth(line, width, 'center'))
    .join('\n')
}

function toolThumbnail(tool: ToolDefinition): StyledText {
  const innerWidth = TOOL_TILE_WIDTH - 2
  const glyphWidth = getVisualWidth(tool.glyph)
  const name = truncateToVisualWidth(tool.name.toUpperCase(), innerWidth - glyphWidth - 1)
  const labelWidth = glyphWidth + 1 + getVisualWidth(name)
  const leftPadding = Math.max(0, Math.floor((innerWidth - labelWidth) / 2))
  const rightPadding = Math.max(0, innerWidth - labelWidth - leftPadding)

  return new StyledText([
    bold(fg(theme.accent)(`${' '.repeat(leftPadding)}${tool.glyph} `)),
    bold(fg(theme.text)(`${name}${' '.repeat(rightPadding)}\n\n`)),
    fg(theme.textMuted)(centeredLines(tool.description, innerWidth))
  ])
}

export function createToolLauncher(
  renderer: CliRenderer,
  tools: ToolDefinition[],
  options: ToolLauncherOptions = {}
): ToolLauncher {
  if (tools.length === 0) throw new Error('The tool launcher requires at least one tool.')

  let selectedIndex = Math.max(
    0,
    tools.findIndex((tool) => tool.id === options.initialToolId)
  )
  let launching = false
  let disposed = false

  const root = new BoxRenderable(renderer, {
    id: 'tool-launcher',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: theme.background
  })

  const header = new BoxRenderable(renderer, {
    id: 'launcher-header',
    width: '100%',
    height: 1,
    paddingX: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surfaceRaised
  })
  const brandSection = new BoxRenderable(renderer, {
    id: 'launcher-brand-section',
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: 'row'
  })
  const introductionSection = new BoxRenderable(renderer, {
    id: 'launcher-introduction-section',
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: 'row',
    justifyContent: 'center'
  })
  const versionSection = new BoxRenderable(renderer, {
    id: 'launcher-version-section',
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end'
  })
  const project = options.projectName ?? (path.basename(process.cwd()) || process.cwd())
  const brand = new TextRenderable(renderer, {
    id: 'launcher-brand',
    height: 1,
    content: new StyledText([bold(fg(theme.accent)('🅿 ')), fg(theme.border)('⧸'), bold(fg(theme.text)(project))])
  })
  const introduction = new TextRenderable(renderer, {
    id: 'launcher-introduction',
    width: 30,
    height: 1,
    content: new StyledText([fg(theme.textMuted)('select tool for this workspace')])
  })
  const version = new TextRenderable(renderer, {
    id: 'launcher-version',
    height: 1,
    content: new StyledText([fg(theme.textMuted)(`v${VERSION}`)])
  })
  brandSection.add(brand)
  introductionSection.add(introduction)
  versionSection.add(version)
  header.add(brandSection)
  header.add(introductionSection)
  header.add(versionSection)

  const body = new BoxRenderable(renderer, {
    id: 'launcher-body',
    width: '100%',
    flexGrow: 1,
    paddingX: GRID_PADDING_X,
    flexDirection: 'column',
    justifyContent: 'flex-start',
    backgroundColor: theme.background
  })
  const categoryIndexes = new Map<string, number[]>()
  for (const [index, tool] of tools.entries()) {
    const category = tool.category ?? DEVELOPER_TOOLS_CATEGORY
    const indexes = categoryIndexes.get(category)
    if (indexes) indexes.push(index)
    else categoryIndexes.set(category, [index])
  }

  const categoryLayouts = [...categoryIndexes].map(([category, indexes]) => {
    const slug = category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const heading = new TextRenderable(renderer, {
      id: `tool-category-${slug}`,
      width: '100%',
      height: 1,
      marginTop: 1,
      content: new StyledText([bold(fg(theme.info)(category.toUpperCase()))])
    })
    const grid = new BoxRenderable(renderer, {
      id: `tool-grid-${slug}`,
      width: '100%',
      paddingTop: 1,
      height: TOOL_TILE_HEIGHT + 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      gap: TOOL_TILE_GAP,
      backgroundColor: theme.background
    })
    body.add(heading)
    body.add(grid)
    return { grid, indexes }
  })

  const gridByToolIndex = new Map<number, BoxRenderable>()
  for (const layout of categoryLayouts) {
    for (const index of layout.indexes) gridByToolIndex.set(index, layout.grid)
  }

  const tiles = tools.map((tool, index) => {
    const tile = new BoxRenderable(renderer, {
      id: `tool-${tool.id}`,
      width: TOOL_TILE_WIDTH,
      height: TOOL_TILE_HEIGHT,
      border: true,
      borderStyle: 'single',
      borderColor: theme.border,
      flexDirection: 'column',
      justifyContent: 'center',
      backgroundColor: theme.surface
    })
    const thumbnail = new TextRenderable(renderer, {
      id: `tool-${tool.id}-thumbnail`,
      width: '100%',
      height: 3,
      content: toolThumbnail(tool)
    })
    tile.add(thumbnail)
    gridByToolIndex.get(index)!.add(tile)
    return tile
  })

  const footer = new BoxRenderable(renderer, {
    id: 'launcher-footer',
    width: '100%',
    height: 1,
    paddingX: 2,
    flexDirection: 'row',
    backgroundColor: theme.surfaceRaised
  })
  const shortcuts = new TextRenderable(renderer, {
    id: 'launcher-shortcuts',
    flexGrow: 1,
    height: 1,
    content: new StyledText([
      fg(theme.text)(' ⛖ '),
      fg(theme.textMuted)('navigate   '),
      fg(theme.text)(' enter '),
      fg(theme.textMuted)('launch   '),
      fg(theme.text)(' q '),
      fg(theme.textMuted)('quit')
    ])
  })
  const status = new TextRenderable(renderer, {
    id: 'launcher-status',
    height: 1,
    content: ''
  })
  footer.add(shortcuts)
  footer.add(status)

  root.add(header)
  root.add(body)
  root.add(footer)
  renderer.root.add(root)

  const setStatus = (message: string, tone: LauncherTone = 'normal'): void => {
    status.content = new StyledText([fg(statusColor(tone))(message)])
  }

  const refreshSelection = (): void => {
    for (const [index, tile] of tiles.entries()) {
      const selected = index === selectedIndex
      tile.borderStyle = selected ? 'double' : 'single'
      tile.borderColor = selected ? theme.borderFocused : theme.border
      tile.backgroundColor = selected ? theme.surfaceRaised : theme.surface
    }
    setStatus(`${tools[selectedIndex]!.name} selected`, 'active')
  }

  let layoutRows: number[][] = []
  const visualOrder = categoryLayouts.flatMap((layout) => layout.indexes)

  const updateGrid = (): void => {
    const availableWidth = Math.max(TOOL_TILE_WIDTH, renderer.terminalWidth - GRID_PADDING_X * 2)
    const columns = Math.max(1, Math.floor((availableWidth + TOOL_TILE_GAP) / (TOOL_TILE_WIDTH + TOOL_TILE_GAP)))
    layoutRows = []
    for (const layout of categoryLayouts) {
      const rows: number[][] = []
      for (let index = 0; index < layout.indexes.length; index += columns) {
        rows.push(layout.indexes.slice(index, index + columns))
      }
      layoutRows.push(...rows)
      layout.grid.height = 1 + rows.length * TOOL_TILE_HEIGHT + Math.max(0, rows.length - 1) * TOOL_TILE_GAP
    }
  }

  const select = (nextIndex: number): void => {
    if (!tools[nextIndex] || nextIndex === selectedIndex) return
    selectedIndex = nextIndex
    refreshSelection()
  }

  const moveHorizontal = (direction: -1 | 1): void => {
    const position = visualOrder.indexOf(selectedIndex)
    select(visualOrder[Math.max(0, Math.min(visualOrder.length - 1, position + direction))]!)
  }

  const moveVertical = (direction: -1 | 1): void => {
    const rowIndex = layoutRows.findIndex((row) => row.includes(selectedIndex))
    if (rowIndex === -1) return
    const nextRow = layoutRows[rowIndex + direction]
    if (!nextRow) return
    const column = layoutRows[rowIndex]!.indexOf(selectedIndex)
    select(nextRow[Math.min(column, nextRow.length - 1)]!)
  }

  const launchSelected = (): void => {
    if (launching) return
    launching = true
    const tool = tools[selectedIndex]!
    setStatus(`Opening ${tool.name}…`, 'active')

    void (async () => {
      try {
        await options.onLaunch?.(tool)
      } catch (error) {
        if (!disposed) {
          setStatus(error instanceof Error ? error.message : String(error), 'error')
        }
      } finally {
        if (!disposed) launching = false
      }
    })()
  }

  const consume = (key: KeyEvent): void => {
    key.preventDefault()
    key.stopPropagation()
  }

  const keyHandler = (key: KeyEvent): void => {
    if ((key.ctrl && key.name === 'c') || key.name === 'q') {
      consume(key)
      options.onQuit?.()
      return
    }
    if (launching) return

    if (key.name === 'left' || key.name === 'h') {
      moveHorizontal(-1)
    } else if (key.name === 'right' || key.name === 'l') {
      moveHorizontal(1)
    } else if (key.name === 'up' || key.name === 'k') {
      moveVertical(-1)
    } else if (key.name === 'down' || key.name === 'j') {
      moveVertical(1)
    } else if (key.name === 'return' || key.name === 'enter' || key.sequence === '\r') {
      launchSelected()
    } else {
      return
    }
    consume(key)
  }

  const resizeHandler = (): void => updateGrid()

  renderer.keyInput.on('keypress', keyHandler)
  renderer.on(CliRenderEvents.RESIZE, resizeHandler)
  updateGrid()
  refreshSelection()

  return {
    root,
    get selectedIndex() {
      return selectedIndex
    },
    get selectedTool() {
      return tools[selectedIndex]!
    },
    setStatus,
    dispose() {
      if (disposed) return
      disposed = true
      renderer.keyInput.off('keypress', keyHandler)
      renderer.off(CliRenderEvents.RESIZE, resizeHandler)
      if (root.parent) renderer.root.remove(root)
      root.destroyRecursively()
    }
  }
}

export async function runInteractiveToolbox(target: string, options: AnalyzeProjectOptions = {}): Promise<void> {
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

  let activeDispose: (() => void) | undefined
  let launcher: ToolLauncher | undefined
  let lastToolId = MORTI_TOOL.id

  const showLauncher = (): void => {
    activeDispose?.()
    launcher = createToolLauncher(
      renderer,
      [MORTI_TOOL, ANALYZER_TOOL, MEMORY_TOOL, KITTY_TOOL, ALACRITTY_TOOL, HERDR_TOOL],
      {
        projectName: path.basename(path.resolve(target)) || target,
        initialToolId: lastToolId,
        onLaunch: openTool,
        onQuit: () => renderer.destroy()
      }
    )
    activeDispose = launcher.dispose
  }

  async function openTool(tool: ToolDefinition): Promise<void> {
    lastToolId = tool.id

    if (tool.id === MORTI_TOOL.id) {
      const analysis = await analyzeProject(target, options)
      if (renderer.isDestroyed) return

      const dashboard = createDiagnosisDashboard(renderer, analysis, {
        onQuit: () => renderer.destroy(),
        onBack: showLauncher,
        onRescan: () => analyzeProject(target, options)
      })
      launcher?.dispose()
      activeDispose = dashboard.dispose
      return
    }

    if (tool.id === ANALYZER_TOOL.id) {
      const analysis = await analyzeCodeHealth(target, options)
      if (renderer.isDestroyed) return

      const dashboard = createAnalyzerDashboard(renderer, analysis, {
        onQuit: () => renderer.destroy(),
        onBack: showLauncher,
        onRescan: (signal) => analyzeCodeHealth(target, { ...options, signal })
      })
      launcher?.dispose()
      activeDispose = dashboard.dispose
      return
    }

    if (tool.id === MEMORY_TOOL.id) {
      const dashboard = createMemoryDashboard(renderer, {
        onQuit: () => renderer.destroy(),
        onBack: showLauncher
      })
      launcher?.dispose()
      activeDispose = dashboard.dispose
      return
    }

    if (tool.id === KITTY_TOOL.id) {
      const config = await loadKittyConfig()
      if (renderer.isDestroyed) return

      const dashboard = createKittyDashboard(renderer, config, {
        onQuit: () => renderer.destroy(),
        onBack: showLauncher
      })
      launcher?.dispose()
      activeDispose = dashboard.dispose
      return
    }

    if (tool.id === ALACRITTY_TOOL.id) {
      const config = await loadAlacrittyConfig()
      if (renderer.isDestroyed) return

      const dashboard = createAlacrittyDashboard(renderer, config, {
        onQuit: () => renderer.destroy(),
        onBack: showLauncher
      })
      launcher?.dispose()
      activeDispose = dashboard.dispose
      return
    }

    if (tool.id === HERDR_TOOL.id) {
      const config = await loadHerdrConfig()
      if (renderer.isDestroyed) return

      const dashboard = createHerdrDashboard(renderer, config, {
        onQuit: () => renderer.destroy(),
        onBack: showLauncher
      })
      launcher?.dispose()
      activeDispose = dashboard.dispose
      return
    }

    throw new Error(`Unknown tool: ${tool.name}`)
  }

  showLauncher()

  try {
    await completed
  } finally {
    activeDispose?.()
    if (!renderer.isDestroyed) renderer.destroy()
  }
}

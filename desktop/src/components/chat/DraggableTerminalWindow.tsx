import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { terminalApi } from '../../api/terminal'
import { MonacoEditorPanel } from '../editor/MonacoEditorPanel'
import { BrowserModule } from '../modules/BrowserModule'
import { DocumentModule } from '../modules/DocumentModule'
import { GitModule } from '../modules/GitModule'
import { FigmaModule } from '../modules/FigmaModule'

async function openPopoutWindow(label: string) {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.setFocus()
      return
    }
    const popout = new WebviewWindow(label, {
      url: '/terminal-popout.html',
      title: '开发工作室',
      width: 1100,
      height: 750,
      decorations: true,
      center: true,
      resizable: true,
    })
    popout.once('tauri://error', (e) => {
      console.error('Popout window error:', e)
    })
  } catch (err) {
    console.warn('Tauri WebviewWindow not available, falling back to portal mode:', err)
  }
}

type Props = {
  open: boolean
  onToggle: () => void
  onClose: () => void
  cwd?: string
  onCwdChange?: (newCwd: string) => void
}

// ===== Types =====

interface OpenFile {
  id: string
  name: string
  path: string
  content: string
  language: string
  modified: boolean
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

interface TerminalInstance {
  id: number
  name: string
  type: TerminalType
  active: boolean
}

type TerminalType = 'powershell' | 'cmd' | 'bash' | 'python' | 'nodejs' | 'wsl' | 'git' | 'docker' | 'ssh' | 'java' | 'cli' | 'terminal'

type TerminalTabType = 'console' | 'problems' | 'output' | 'debug' | 'terminal'

// Module system types
type ModuleType = 'editor' | 'terminal' | 'document' | 'browser' | 'git' | 'figma' | 'agent' | 'mcp' | 'settings'

interface ModuleTab {
  id: string
  type: ModuleType
  name: string
  icon: string
}

const MODULE_META: Record<ModuleType, { name: string; icon: string; color: string }> = {
  editor:   { name: '编辑器',   icon: '</>',  color: 'text-green-400' },
  terminal: { name: '终端',  icon: '>_',   color: 'text-cyan-400' },
  document: { name: '文档',  icon: '\u{1F4C4}',   color: 'text-purple-400' },
  browser:  { name: '浏览器',   icon: '\u{1F310}',   color: 'text-blue-400' },
  git:      { name: '代码版本',       icon: '\u{1F516}',   color: 'text-orange-400' },
  figma:    { name: 'Figma',     icon: '\u{1FA77}',   color: 'text-pink-400' },
  agent:    { name: '智能体',     icon: '\u{1F9E0}',   color: 'text-indigo-400' },
  mcp:      { name: 'MCP',       icon: '\u{2699}',   color: 'text-yellow-400' },
  settings: { name: '设置',  icon: '\u{2699}',    color: 'text-gray-400' },
}

const MODULE_MENU_ITEMS: ModuleType[] = ['editor','terminal','document','browser','git','figma','agent','mcp','settings']

const TERMINAL_TYPE_LABELS: Record<TerminalType, string> = {
  powershell: 'PowerShell', cmd: 'CMD', bash: 'Bash', python: 'Python',
  nodejs: 'Node.js', wsl: 'WSL', git: 'Git', docker: 'Docker',
  ssh: 'SSH', java: 'Java', cli: 'CLI', terminal: 'Terminal',
}

const TERMINAL_TYPE_ICONS: Record<TerminalType, string> = {
  powershell: '\u{1F4BB}', cmd: '\u{1F4BB}', bash: '\u{1F411}', python: '\u{1F40D}',
  nodejs: '\u{22C9}', wsl: '\u{1F433}', git: '\u{1F516}', docker: '\u{1F433}',
  ssh: '\u{1F511}', java: '\u{2615}', cli: '\u{2756}', terminal: '\u{1F5A5}',
}

// ===== Constants =====

const MIN_WIDTH = 500
const MIN_HEIGHT = 400
const INITIAL_WIDTH = 1100
const INITIAL_HEIGHT = 700
const LANGUAGES = ['javascript', 'typescript', 'python', 'json', 'html', 'css', 'markdown', 'shell', 'rust', 'go', 'java', 'plaintext']

// ===== Real filesystem-based file tree builder using Tauri API =====

const IGNORED_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', '.next', '.nuxt',
  '__pycache__', '.cache', '.turbo', '.output', '.cache',
  'coverage', '.pytest_cache', '.mypy_cache', '.venv', 'venv',
  '.DS_Store', 'Thumbs.db', '.idea', '.vscode',
])

async function readDirEntries(dirPath: string): Promise<FileNode[]> {
  // Guard: only use Tauri FS API inside Tauri runtime (not Vite browser preview)
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  if (!isTauri) return []
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(dirPath)
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (!entry.name || IGNORED_NAMES.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      const nodePath = dirPath + (dirPath.endsWith('\\') || dirPath.endsWith('/') ? '' : '/') + entry.name
      nodes.push({
        name: entry.name,
        path: nodePath,
        type: entry.isDirectory ? 'directory' : 'file',
        children: undefined,
      })
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return nodes
  } catch { return [] }
}

export async function buildFileTreeFromPath(dirPath: string): Promise<FileNode[]> {
  const entries = await readDirEntries(dirPath)
  // Recursively load children for each directory
  const nodesWithChildren: FileNode[] = []
  for (const entry of entries) {
    if (entry.type === 'directory') {
      try {
        entry.children = await buildFileTreeFromPath(entry.path)
      } catch {
        entry.children = []
      }
    }
    nodesWithChildren.push(entry)
  }
  return nodesWithChildren
}

/** Shared panel close/min/max/merge controls */
function PanelControls({ onClose, onMinimize, onMaximize, onMerge, onUnmerge, onPopout, size = 'sm' }: {
  onClose: () => void; onMinimize?: () => void; onMaximize?: () => void; onMerge?: () => void; onUnmerge?: () => void; onPopout?: () => void; size?: 'sm' | 'xs'
}) {
  const s = size === 'xs'
    ? 'h-[17px] w-[17px] text-[9px]'
    : 'h-5 w-5 text-[11px]'
  return (
    <div className="flex items-center gap-1">
      {onMinimize && (
        <button data-no-drag onMouseDown={e => e.stopPropagation()} onClick={onMinimize}
          className={`flex ${s} shrink-0 items-center justify-center rounded bg-yellow-600/80 font-bold text-white transition-colors hover:bg-yellow-500`}
          title="最小化"
        >&#8722;</button>
      )}
      {onPopout && (
        <button data-no-drag onMouseDown={e => e.stopPropagation()} onClick={onPopout}
          className={`flex ${s} shrink-0 items-center justify-center rounded bg-teal-600/70 font-bold text-white transition-colors hover:bg-teal-500`}
          title="拖出为独立窗口"
        >&#8599;</button>
      )}
      {onMerge && !onUnmerge && (
        <button data-no-drag onMouseDown={e => e.stopPropagation()} onClick={onMerge}
          className={`flex ${s} shrink-0 items-center justify-center rounded bg-blue-600/70 font-bold text-white transition-colors hover:bg-blue-500`}
          title="合并到主窗口"
        >&#8617;</button>
      )}
      {onUnmerge && (
        <button data-no-drag onMouseDown={e => e.stopPropagation()} onClick={onUnmerge}
          className={`flex ${s} shrink-0 items-center justify-center rounded bg-purple-600/70 font-bold text-white transition-colors hover:bg-purple-500`}
          title="弹出为独立窗口"
        >&#8618;</button>
      )}
      {onMaximize && (
        <button data-no-drag onMouseDown={e => e.stopPropagation()} onClick={onMaximize}
          className={`flex ${s} shrink-0 items-center justify-center rounded bg-emerald-700/70 font-bold text-white transition-colors hover:bg-emerald-600`}
          title="最大化"
        >&#9633;</button>
      )}
      <button data-no-drag onMouseDown={e => e.stopPropagation()} onClick={onClose}
        className={`flex ${s} shrink-0 items-center justify-rounded !bg-red-500 !font-bold !text-white shadow-sm shadow-red-400/40 transition-colors hover:!bg-red-400`}
        title="关闭"
      >&#10005;</button>
    </div>
  )
}


export function DraggableTerminalWindow({ open, onToggle, onClose, cwd, onCwdChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [initialized, setInitialized] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: INITIAL_WIDTH, h: INITIAL_HEIGHT })

  // Layout
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [isMerged, setIsMerged] = useState(false)

  // Per-module states
  const [terminalMode, setTerminalMode] = useState<'full' | 'panel' | 'hidden'>('panel')

  // Editor
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [editorVimMode, setEditorVimMode] = useState(false)
  const [terminalVimMode, setTerminalVimMode] = useState(false)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [newFileCounter, setNewFileCounter] = useState(1)
  const [newTermMenuPos, setNewTermMenuPos] = useState({ top: 0, left: 0 })
  const [settingsMenuPos, setSettingsMenuPos] = useState({ top: 0, right: 0 })


  // Terminal
  const [terminalTab, setTerminalTab] = useState<TerminalTabType>('terminal')
  const [terminals, setTerminals] = useState<TerminalInstance[]>([
    { id: 1, name: 'powershell 1', type: 'powershell', active: true },
  ])
  const [activeTerminalId, setActiveTerminalId] = useState(1)
  const [nextTerminalId, setNextTerminalId] = useState(2)

  // Popups
  const [showSettings, setShowSettings] = useState(false)
  const [showNewTermMenu, setShowNewTermMenu] = useState(false)
  const [logLevels, setLogLevels] = useState({ error: true, warning: true, info: true })

  // File tree - dynamic, rebuildable when directory changes
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [fileTree, setFileTree] = useState<FileNode[]>([])

  // Editor/Terminal height split (percentage for editor area within browse/edit region)
  const [editorHeightPct, setEditorHeightPct] = useState(65)

  // Workspace directory
  const [workspacePath, setWorkspacePath] = useState(cwd || '')

  // Sync workspacePath with external cwd prop
  useEffect(() => {
    if (cwd && cwd !== workspacePath) {
      setWorkspacePath(cwd)
    }
  }, [cwd])

  // Window-level minimize/visibility
  const [windowMinimized, setWindowMinimized] = useState(false)

  // Module tab system
  const [modules, setModules] = useState<ModuleTab[]>([
    { id: 'mod-1', type: 'editor', name: '编辑器', icon: '</>' },
    { id: 'mod-2', type: 'terminal', name: '终端', icon: '>_' },
  ])
  const [activeModuleId, setActiveModuleId] = useState('mod-1')
  const [showNewModuleMenu, setShowNewModuleMenu] = useState(false)

  // DRAG / RESIZE - single global handler via ref

  /** Stores all mutable drag state so closures never go stale */
  const ds = useRef({
    mode: '' as '' | 'window' | 'h-split' | 'v-split' | 'resize',
    resizeDir: '',
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
    startLeft: 0,
    startTop: 0,
    startEditorPct: 0,
    startSidebarW: 0,
  })

  const posRef = useRef(pos)
  const sizeRef = useRef(size)
  const sideWRef = useRef(sidebarWidth)
  const editorPctRef = useRef(editorHeightPct)

  // Keep refs in sync with state
  useEffect(() => { posRef.current = pos }, [pos])
  useEffect(() => { sizeRef.current = size }, [size])
  useEffect(() => { sideWRef.current = sidebarWidth }, [sidebarWidth])
  useEffect(() => { editorPctRef.current = editorHeightPct }, [editorHeightPct])

  // One-time global listener setup on document (works in Tauri WebView)
  useEffect(() => {
    let frameId = 0

    const onMouseMove = (_e: MouseEvent) => {
      if (!ds.current.mode) return
      const e = _e as any

      switch (ds.current.mode) {
        case 'window': {
          setPos({
            x: Math.max(-sizeRef.current.w + 150, Math.min(window.innerWidth - 50, e.clientX - ds.current.offsetX)),
            y: Math.max(0, Math.min(window.innerHeight - 30, e.clientY - ds.current.offsetY)),
          })
          break
        }
        case 'v-split': {
          const dx = e.clientX - ds.current.startX
          setSidebarWidth(Math.max(120, Math.min(450, ds.current.startSidebarW + dx)))
          break
        }
        case 'h-split': {
          const containerH = sizeRef.current.h
          const contentH = Math.max(200, containerH - 130)
          const dy = e.clientY - ds.current.startY
          const deltaPct = (dy / contentH) * 100
          setEditorHeightPct(Math.max(20, Math.min(80, ds.current.startEditorPct + deltaPct)))
          break
        }
        case 'resize': {
          const dir = ds.current.resizeDir
          let nw = ds.current.startW, nh = ds.current.startH
          if (dir.includes('e')) nw = Math.max(MIN_WIDTH, ds.current.startW + (e.clientX - ds.current.startX))
          if (dir.includes('s')) nh = Math.max(MIN_HEIGHT, ds.current.startH + (e.clientY - ds.current.startY))
          if (dir.includes('w')) nw = Math.max(MIN_WIDTH, ds.current.startW - (e.clientX - ds.current.startX))
          if (dir.includes('n')) nh = Math.max(MIN_HEIGHT, ds.current.startH - (e.clientY - ds.current.startY))
          setSize({ w: nw, h: nh })
          break
        }
      }
    }

    const onMouseUp = () => {
      if (!ds.current.mode) return
      cancelAnimationFrame(frameId)
      ds.current.mode = ''
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  /** Call when user initiates a drag */
  const beginDrag = useCallback((mode: typeof ds.current.mode, extra?: Partial<typeof ds.current>) => {
    ds.current.mode = mode
    Object.assign(ds.current, extra || {})
    document.body.style.cursor =
      mode === 'window' ? 'move'
      : mode === 'v-split' ? 'col-resize'
      : mode === 'h-split' ? 'row-resize'
      : `${extra?.resizeDir || ''}-resize`
    document.body.style.userSelect = 'none'
  }, [])

  // Initialize position and load workspace files
  useEffect(() => {
    if (open && !initialized) {
      setPos({ x: 80, y: 60 })
      setInitialized(true)
      if (cwd || workspacePath) {
        const dir = cwd || workspacePath
        buildFileTreeFromPath(dir).then((tree) => {
          setFileTree(tree)
          const rootPaths = new Set<string>(tree.map(n => n.path))
          setExpandedDirs(rootPaths)
        }).catch(() => {})
      }
    }
    if (!open) {
      setInitialized(false)
    }
  }, [open])

  // Xterm init
  const termRefs = useRef<Map<number, { el: HTMLDivElement; fit: any; term: any }>>(new Map())
  const sessionIds = useRef<Map<number, number>>(new Map())
  const newTermBtnRef = useRef<HTMLButtonElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  // Calculate popup menu positions
  useEffect(() => {
    if (showNewTermMenu && newTermBtnRef.current) {
      const rect = newTermBtnRef.current.getBoundingClientRect()
      setNewTermMenuPos({ top: rect.top - 4, left: Math.max(0, rect.right - 180) })
    }
  }, [showNewTermMenu])
  useEffect(() => {
    if (showSettings && settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect()
      setSettingsMenuPos({ top: rect.top - 4, right: window.innerWidth - rect.left - 8 })
    }
  }, [showSettings])

  useEffect(() => {
    if (!open || !initialized) return
    const tids = terminals.map(t => t.id)
    let cancelled = false

    async function initXtermForTid(tid: number) {
      const el = document.getElementById(`xterm-${tid}`)
      if (!el) return
      if (el.dataset.inited === 'true') return

      if (!terminalApi.isAvailable()) return
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      if (cancelled) return

      const terminal = new Terminal({
        cursorBlink: true, fontSize: 12, lineHeight: 1.25,
        fontFamily: "var(--font-mono), Consolas, monospace",
        theme: {
          background: '#0e0e12', foreground: '#d7d2d0', cursor: '#ffb59f',
          selectionBackground: '#5f4a40', black: '#1f1f1f', red: '#ff6d67',
          green: '#7ef18a', yellow: '#f8c55f', blue: '#77a8ff', magenta: '#d699ff',
          cyan: '#61d6d6', white: '#d7d2d0', brightBlack: '#8f8683',
          brightRed: '#ff8a85', brightGreen: '#9ff7a7', brightYellow: '#ffdd7a',
          brightBlue: '#a6c5ff', brightMagenta: '#e3b8ff', brightCyan: '#8ceeee',
          brightWhite: '#ffffff',
        },
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(el as HTMLElement)
      fit.fit()
      el!.dataset.inited = 'true'
      termRefs.current.set(tid, { el: el as HTMLDivElement, fit, term: terminal })

      const outputUnlisten = await terminalApi.onOutput((payload: { session_id: number; data: string }) => {
        const sid = sessionIds.current.get(tid)
        if (payload.session_id === sid) terminal.write(payload.data)
      })
      const exitUnlisten = await terminalApi.onExit((payload) => {
        const sid = sessionIds.current.get(tid)
        if (payload.session_id !== sid) return
        terminal.writeln(`\r\n[process exited: ${payload.code}${payload.signal ? `, ${payload.signal}` : ''}]`)
        sessionIds.current.delete(tid)
      })
      terminal.onData((data) => {
        const sid = sessionIds.current.get(tid)
        if (sid) void terminalApi.write(sid, data).catch(() => {})
      })
      try {
        const result = await terminalApi.spawn({ cols: terminal.cols, rows: terminal.rows, cwd: workspacePath || cwd })
        if (!cancelled) sessionIds.current.set(tid, result.session_id)
      } catch { outputUnlisten(); exitUnlisten(); terminal.writeln('\r\nFailed to spawn shell') }

      ;(el as any).__cleanup = () => {
        outputUnlisten?.(); exitUnlisten?.()
        try { terminal.dispose() } catch {}
        termRefs.current.delete(tid); sessionIds.current.delete(tid)
      }
    }

    for (const tid of tids) {
      void initXtermForTid(tid)
    }
    return () => { cancelled = true }
  }, [open, initialized, terminals.length, cwd, workspacePath])

  useEffect(() => {
    const ref = termRefs.current.get(activeTerminalId)
    if (ref) {
      requestAnimationFrame(() => { try { ref.fit.fit() } catch {} })
      setTimeout(() => { try { ref.fit.fit() } catch {} }, 100)
    }
  }, [sidebarWidth, size, activeTerminalId])

  // Event Handlers
  const handleTitleDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('[data-no-drag]')) return
    e.preventDefault()
    e.stopPropagation()
    const rect = containerRef.current!.getBoundingClientRect()
    beginDrag('window', {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    })
  }, [beginDrag])

  const handleResizeDown = useCallback((dir: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    beginDrag('resize', {
      resizeDir: dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: size.w,
      startH: size.h,
      startLeft: pos.x,
      startTop: pos.y,
    })
  }, [beginDrag, size, pos])

  const handleVSplitDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    beginDrag('v-split', { startX: e.clientX, startSidebarW: sidebarWidth })
  }, [beginDrag, sidebarWidth])

  const handleHSplitDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    beginDrag('h-split', {
      startX: e.clientX,
      startY: e.clientY,
      startEditorPct: editorHeightPct,
    })
  }, [beginDrag, editorHeightPct])

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const n = new Set(prev)
      n.has(path) ? n.delete(path) : n.add(path)
      return n
    })
  }, [])

  const openFileInEditor = useCallback(async (node: FileNode) => {
    if (node.type !== 'file') return
    const ext = node.path.split('.').pop()?.toLowerCase() || ''
    const langMap: Record<string, string> = { js:'javascript', ts:'typescript', py:'python', json:'json', html:'html', css:'css', md:'markdown', sh:'shell', rs:'rust', go:'go', java:'java', tsx:'typescript', jsx:'javascript', yaml:'yaml', yml:'yaml', toml:'toml', xml:'xml', sql:'sql', vue:'vue', svelte:'svelte' }
    const existing = openFiles.find(f => f.path === node.path)
    if (existing) {
      setActiveFileId(existing.id)
      const editorMod = modules.find(m => m.type === 'editor')
      if (editorMod) setActiveModuleId(editorMod.id)
      return
    }

    let content = ''
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      console.log('[Terminal] Reading file:', node.path)
      const rawContent = await readTextFile(node.path)
      content = typeof rawContent === 'string' ? rawContent : (rawContent ? String(rawContent) : '')
      console.log('[Terminal] File loaded successfully, length:', content.length, 'type:', typeof rawContent)
      if (!content && rawContent !== '') {
        console.warn('[Terminal] Content conversion issue, raw:', typeof rawContent, rawContent?.slice(0, 100))
      }
    } catch (err) {
      console.error('[Terminal] Failed to read file:', node.path, err)
      const errMsg = err instanceof Error ? err.message : String(err)
      content = `// ⚠️ Error loading file: ${node.name}\n// Path: ${node.path}\n// Error: ${errMsg}\n//\n// Please check:\n// 1. File exists and is accessible\n// 2. Tauri fs permissions are granted\n// 3. File encoding is supported\n`
    }

    if (!content || content.trim().length === 0) {
      console.warn('[Terminal] File content is empty:', node.path)
      content = `// ℹ️ File: ${node.name}\n// Path: ${node.path}\n// Size: (content appears empty)\n//\n// The file may be empty or could not be read.\n`
    }

    const nf: OpenFile = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      name: node.name, path: node.path,
      content, language: langMap[ext]||'plaintext', modified: false,
    }
    console.log('[Terminal] Creating editor file:', { id: nf.id, name: nf.name, contentLength: content.length })
    setOpenFiles(p => [...p, nf])
    setActiveFileId(nf.id)
    const editorMod = modules.find(m => m.type === 'editor')
    if (editorMod) setActiveModuleId(editorMod.id)
  }, [openFiles, modules])

  const addTerminal = useCallback((t?: TerminalType) => {
    const type = t || terminals.find(t=>t.active)?.type || 'powershell'
    const id = nextTerminalId
    setNextTerminalId(p=>p+1)
    setTerminals(p => p.map(t=>({...t,active:false})).concat({id, name:`${TERMINAL_TYPE_LABELS[type]} ${id}`, type, active:true}))
    setActiveTerminalId(id); setShowNewTermMenu(false)
  }, [terminals, nextTerminalId])

  const removeTerminal = useCallback((id: number) => {
    const el = document.getElementById(`xterm-${id}`); if(el) try{(el as any).__cleanup?.()}catch{}
    setTerminals(p => {
      const r = p.filter(t=>t.id!==id)
      if(r.length && activeTerminalId===id){const na=r[r.length-1]; if(na){setActiveTerminalId(na.id);return r.map(t=>({...t,active:t.id===na.id}))}}
      if(!r.length)setShowSettings(false)
      return r
    })
  }, [activeTerminalId])

  const restartTerminal = useCallback((id: number) => {
    const el = document.getElementById(`xterm-${id}`)
    if (!el) return
    try { (el as any).__cleanup?.() } catch {}
    delete (el as any).__cleanup
    el.dataset.inited = ''
    termRefs.current.delete(id)
    sessionIds.current.delete(id)
    void (async () => {
      if (!terminalApi.isAvailable()) return
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      const terminal = new Terminal({
        cursorBlink: true, fontSize: 12, lineHeight: 1.25,
        fontFamily: "var(--font-mono), Consolas, monospace",
        theme: {
          background: '#0e0e12', foreground: '#d7d2d0', cursor: '#ffb59f',
          selectionBackground: '#5f4a40', black: '#1f1f1f', red: '#ff6d67',
          green: '#7ef18a', yellow: '#f8c55f', blue: '#77a8ff', magenta: '#d699ff',
          cyan: '#61d6d6', white: '#d7d2d0', brightBlack: '#8f8683',
          brightRed: '#ff8a85', brightGreen: '#9ff7a7', brightYellow: '#ffdd7a',
          brightBlue: '#a6c5ff', brightMagenta: '#e3b8ff', brightCyan: '#8ceeee',
          brightWhite: '#ffffff',
        },
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(el as HTMLElement)
      fit.fit()
      el.dataset.inited = 'true'
      termRefs.current.set(id, { el: el as HTMLDivElement, fit, term: terminal })
      const outputUnlisten = await terminalApi.onOutput((payload: { session_id: number; data: string }) => {
        const sid = sessionIds.current.get(id)
        if (payload.session_id === sid) terminal.write(payload.data)
      })
      const exitUnlisten = await terminalApi.onExit((payload) => {
        const sid = sessionIds.current.get(id)
        if (payload.session_id !== sid) return
        terminal.writeln(`\r\n[process exited: ${payload.code}${payload.signal ? `, ${payload.signal}` : ''}]`)
        sessionIds.current.delete(id)
      })
      terminal.onData((data) => {
        const sid = sessionIds.current.get(id)
        if (sid) void terminalApi.write(sid, data).catch(() => {})
      })
      try {
        const result = await terminalApi.spawn({ cols: terminal.cols, rows: terminal.rows, cwd: workspacePath || cwd })
        sessionIds.current.set(id, result.session_id)
      } catch { outputUnlisten(); exitUnlisten(); terminal.writeln('\r\nFailed to spawn shell') }
      ;(el as any).__cleanup = () => {
        outputUnlisten?.(); exitUnlisten?.()
        try { terminal.dispose() } catch {}
        termRefs.current.delete(id); sessionIds.current.delete(id)
      }
    })()
  }, [workspacePath, cwd])

  // Active file reference
  const activeFile = openFiles.find(f => f.id === activeFileId)

  // Editor Button Actions
  /** + New File */
  const handleNewFile = useCallback(() => {
    const name = `untitled-${newFileCounter}`
    const nf: OpenFile = {
      id: `${Date.now()}-new`,
      name,
      path: `/${name}`,
      content: '',
      language: 'plaintext',
      modified: false,
    }
    setNewFileCounter(c => c + 1)
    setOpenFiles(p => [...p, nf])
    setActiveFileId(nf.id)
  }, [newFileCounter])

  /** Refresh - reload current file content */
  const handleRefresh = useCallback(() => {
    if (!activeFile) return
    const ext = activeFile.name.split('.').pop()?.toLowerCase() || ''
    const defaultContent = ext === 'py'
      ? '# -*- coding: utf-8 -*-\n"""\nDescription:\n\nAuthor: \nDate: ' + new Date().toISOString().slice(0,10) + '\n"""\n\n'
      : ext === 'ts' || ext === 'tsx'
        ? '// TypeScript\n// Created: ' + new Date().toISOString() + '\n\n'
        : ext === 'js' || ext === 'jsx'
          ? '// JavaScript\n// Created: ' + new Date().toISOString() + '\n\n'
          : ext === 'html'
            ? '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>Document</title>\n</head>\n<body>\n  \n</body>\n</html>\n'
            : ext === 'css'
              ? '/* Styles */\n\n'
              : ext === 'json'
                ? '{\n  \n}\n'
                : ext === 'md'
                  ? '# ' + activeFile.name.replace(/\.md$/,'') + '\n\n'
                  : '// ' + activeFile.name + '\n'
    setOpenFiles(p => p.map(f => f.id === activeFileId ? { ...f, content: defaultContent, modified: false } : f))
  }, [activeFile, activeFileId])

  /** Save - mock save operation */
  const handleSave = useCallback(() => {
    if (!activeFile) return
    setOpenFiles(p => p.map(f => f.id === activeFileId ? { ...f, modified: false } : f))
  }, [activeFile, activeFileId])

  /** 选择文件 - open system file picker */
  const handleSelectFile = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Code Files', extensions: ['ts','tsx','js','jsx','py','java','go','rs','json','html','css','md','sh','yaml','yml','toml','xml','sql'] },
      ]})
      if (!selected || Array.isArray(selected)) return
      const pathStr = selected as string
      const fileName = pathStr.split(/[\\/]/).pop() || 'unknown'
      const ext = fileName.split('.').pop()?.toLowerCase() || ''
      const langMap: Record<string, string> = { js:'javascript', ts:'typescript', py:'python', json:'json', html:'html', css:'css', md:'markdown', sh:'shell', rs:'rust', go:'go', java:'java', tsx:'typescript', jsx:'javascript', yaml:'yaml', yml:'yaml', toml:'toml', xml:'xml', sql:'sql' }
      const existing = openFiles.find(f => f.path === pathStr)
      if (existing) { setActiveFileId(existing.id); return }
      let content = ''
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        console.log('[Terminal] Reading file (picker):', pathStr)
        content = await readTextFile(pathStr)
        console.log('[Terminal] File loaded successfully, length:', content.length)
      } catch (err) {
        console.error('[Terminal] Failed to read file (picker):', pathStr, err)
        content = '// Error loading file: ' + fileName + '\n// Path: ' + pathStr + '\n// Error: ' + (err instanceof Error ? err.message : String(err)) + '\n\n'
      }
      const nf: OpenFile = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        name: fileName, path: pathStr,
        content, language: langMap[ext]||'plaintext', modified: false,
      }
      setShowFilePicker(false)
      setOpenFiles(p => [...p, nf]); setActiveFileId(nf.id)
      const editorMod = modules.find(m => m.type === 'editor')
      if (editorMod) setActiveModuleId(editorMod?.id || modules[0]?.id || 'mod-1')
    } catch {
      setShowFilePicker(v => !v)
    }
  }, [openFiles, modules])

  /** Pick file from file tree (helper method) */
  const handlePickFromFileTree = useCallback((node: FileNode) => {
    if (node.type !== 'file') return
    openFileInEditor(node)
    setShowFilePicker(false)
    const editorMod = modules.find(m => m.type === 'editor')
    if (editorMod) setActiveModuleId(editorMod.id)
  }, [openFileInEditor, modules])

  /** Select Workspace Directory - reads REAL filesystem via Tauri API */
  const handlePickDirectory = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false })
      if (!selected || Array.isArray(selected)) return
      const dirPath = selected as string
      setWorkspacePath(dirPath)
      if (onCwdChange) onCwdChange(dirPath)
      const newTree = await buildFileTreeFromPath(dirPath)
      setFileTree(newTree)
      const rootPaths = new Set<string>(newTree.map(n => n.path))
      setExpandedDirs(rootPaths)
    } catch {}
  }, [onCwdChange])

  const handleRefreshFileTree = useCallback(async () => {
    const dir = workspacePath || cwd
    if (!dir) {
      handlePickDirectory()
      return
    }
    try {
      const newTree = await buildFileTreeFromPath(dir)
      setFileTree(newTree)
      const rootPaths = new Set<string>(newTree.map(n => n.path))
      setExpandedDirs(rootPaths)
    } catch {}
  }, [workspacePath, cwd, handlePickDirectory])

  /** Window minimize */
  const handleWindowMinimize = useCallback(() => { setWindowMinimized(true) }, [])
  /** Restore window */
  const handleWindowRestore = useCallback(() => { setWindowMinimized(false) }, [])
  /** Merge window - toggle merged inline mode */
  const handleMergeWindow = useCallback(() => { setIsMerged(m => !m) }, [])
  const handlePopoutWindow = useCallback(() => {
    openPopoutWindow('terminal-popout')
  }, [])

  /** Add new module */
  const handleAddModule = useCallback((type: ModuleType) => {
    const meta = MODULE_META[type]
    const existing = modules.find(m => m.type === type)
    if (existing) { setActiveModuleId(existing.id); setShowNewModuleMenu(false); return }
    const newMod: ModuleTab = { id: `mod-${Date.now()}`, type, name: meta.name, icon: meta.icon }
    setModules(p => [...p, newMod]); setActiveModuleId(newMod.id); setShowNewModuleMenu(false)
  }, [modules])

  /** Close module tab */
  const handleCloseModule = useCallback((id: string) => {
    if (modules.length <= 1) return
    const mod = modules.find(m => m.id === id)
    if (mod?.type === 'terminal') setTerminalMode('hidden')
    setModules(p => p.filter(m => m.id !== id))
    setActiveModuleId(prev => prev === id ? (modules.find(m => m.id !== id)?.id || modules[0]?.id || 'mod-1') : prev)
  }, [modules])

  /** Close editor module tab */
  const handleEditorClose = useCallback(() => {
    setOpenFiles([]); setActiveFileId(null)
    const editorMods = modules.filter(m => m.type === 'editor')
    if (editorMods[0]) handleCloseModule(editorMods[0].id)
  }, [modules, handleCloseModule])

  // Render helpers
  const activeModuleType = modules.find(m => m.id === activeModuleId)?.type || 'editor'

  /** Render module view for non-editor/terminal modules */
  function renderOtherModuleView() {
    if (activeModuleType === 'browser') {
      return <BrowserModule workDir={workspacePath || cwd} />
    }
    if (activeModuleType === 'document') {
      return <DocumentModule workDir={workspacePath || cwd} onOpenFile={(path) => openFileInEditor({ name: path.split(/[\\/]/).pop() || path, path, type: 'file' } as FileNode)} />
    }
    if (activeModuleType === 'git') {
      return <GitModule workDir={workspacePath || cwd} />
    }
    if (activeModuleType === 'figma') {
      return <FigmaModule workDir={workspacePath || cwd} />
    }
    const meta = MODULE_META[activeModuleType as ModuleType]
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#131128]">
        <span className={`text-4xl ${meta?.color||'text-gray-400'}`}>{meta?.icon||'\u{1F4DD}'}</span>
        <span className="text-sm font-medium text-gray-300">{meta?.name||'模块'} 模块</span>
        <span className="max-w-[300px] text-center text-[11px] text-gray-500 leading-relaxed">
          {activeModuleType === 'agent' && 'AI 智能体工作台，用于管理和配置多个 AI Agent'}
          {activeModuleType === 'mcp' && 'MCP (模型上下文协议) 服务连接与管理'}
          {activeModuleType === 'settings' && '全局设置：主题、快捷键、插件配置'}
        </span>
        <button data-no-drag className="mt-2 rounded-lg border border-indigo-600/40 bg-indigo-600/15 px-4 py-1.5 text-[11px] text-indigo-300 hover:bg-indigo-600/25 transition-colors">
          即将推出...
        </button>
      </div>
    )
  }

  function renderTreeNode(n: FileNode, d=0) {
    const ex = expandedDirs.has(n.path)
    return (
      <div key={n.path}>
        <div className={`group flex cursor-pointer items-center gap-1 px-1 py-[1.5px] text-xs ${n.type==='directory'?'hover:bg-white/8':'hover:bg-blue-400/10 hover:text-blue-300'}`}
          style={{paddingLeft:`${d*14+4}px`}}
          onClick={()=>n.type!=='file'?toggleDir(n.path):openFileInEditor(n)}
          onDoubleClick={()=>{if(n.type==='file')openFileInEditor(n)}}>
          <span className="shrink-0 text-[10px] leading-none text-gray-500 w-3">{n.type==='directory'?(ex?'\u25BC':'\u25B6'):''}</span>
          <span className={`shrink-0 text-[11px] ${n.type==='directory'?'text-yellow-300/90':'text-gray-400'}`}>{n.type==='directory'?'\u{1F4C1}':'\u{1F4C4}'}</span>
          <span className="truncate text-[11px] text-gray-300 group-hover:text-gray-100" title={n.name}>{n.name}</span>
        </div>
        {n.type==='directory'&&ex&&n.children?.map(c=>renderTreeNode(c,d+1))}
      </div>
    )
  }

  // Not open
  if (!open || !initialized) {
    return (
      <button onClick={onToggle} title="Terminal"
        className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]">
        <span className="material-symbols-outlined text-[18px]">terminal</span>
      </button>
    )
  }

  // Main Render
  const isEditorActive = activeModuleType === 'editor'
  const isTerminalActive = activeModuleType === 'terminal'

  /** Studio inner content (shared by portal and merged modes) */
  const studioContent = (
    <>
      {/* TITLE BAR */}
      <div onMouseDown={isMerged ? undefined : handleTitleDown}
        className={`flex shrink-0 ${isMerged ? 'cursor-default' : 'cursor-move'} items-center justify-between border-b border-[#2d2652] bg-gradient-to-r from-[#1e1850] via-[#241e48] to-[#1e1850] px-3 py-1.5 select-none`}>
        <div className="flex items-center gap-2">
          <span>&#128187;</span>
          <span className="text-[11px] font-semibold tracking-wide text-indigo-200/90">DEV STUDIO</span>
        </div>
        <PanelControls onClose={onClose} onMinimize={handleWindowMinimize} onMerge={handleMergeWindow} onUnmerge={isMerged ? () => setIsMerged(false) : undefined} onPopout={handlePopoutWindow}/>
      </div>

          {/* MODULE TAB BAR - Top-level module navigation */}
          <div data-no-drag onMouseDown={e=>e.stopPropagation()}
            className="flex shrink-0 items-center border-b border-[#231e42] bg-[#161330] px-1 py-0 gap-0.5">
            {modules.map(mod => {
              const meta = MODULE_META[mod.type]
              const active = mod.id === activeModuleId
              return (
                <button key={mod.id} data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}}
                  onClick={()=>{setActiveModuleId(mod.id); if(mod.type==='terminal') setTerminalMode('full')}}
                  className={`group flex shrink-0 cursor-pointer items-center gap-1 rounded-t px-2.5 py-1 text-[11px] transition-colors ${
                    active ? 'bg-[#282350] text-white font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}>
                  <span className={`${meta.color} ${active ? '' : 'opacity-70'}`}>{meta.icon}</span>
                  <span className="truncate max-w-[100px]">{meta.name}</span>
                  {/* All tabs have close button */}
                  <button data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}}
                    onClick={e=>{e.stopPropagation();handleCloseModule(mod.id)}}
                    className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] opacity-40 transition-all hover:!opacity-100 hover:bg-red-500/30 hover:text-red-300">&#215;</button>
                </button>
              )
            })}
            {/* + New Module Button (with dropdown menu) */}
            <div className="relative ml-auto mr-1">
              <button data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}}
                onClick={()=>setShowNewModuleMenu(v=>!v)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-white/10 hover:text-white text-[16px] font-light">+</button>
              {showNewModuleMenu && (
                <div data-no-drag onMouseDown={e=>e.stopPropagation()}
                  className="absolute top-full right-0 z-50 mt-1 w-[180px] rounded-lg border border-[#3a3466] bg-[#1c1938] py-1 shadow-xl">
                  {MODULE_MENU_ITEMS.map(type => {
                    const m = MODULE_META[type]
                    const exists = modules.some(mod => mod.type === type)
                    return (
                      <button key={type} data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}}
                        onClick={() => handleAddModule(type)}
                        disabled={exists}
                        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11px] transition-colors ${
                          exists ? 'text-gray-600 cursor-default' : 'text-gray-300 hover:bg-indigo-600/25 hover:text-white'
                        }`}>
                        <span className={m.color}>{m.icon}</span>
                        <span>{m.name}</span>
                        {exists && <span className="ml-auto text-[9px] text-gray-600">Open</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* WORKSPACE PATH BAR */}
          <div data-no-drag onMouseDown={e=>e.stopPropagation()}
            className="flex shrink-0 items-center gap-1.5 border-b border-[#231e42] bg-[#161330] px-3 py-1">
            <input readOnly value={workspacePath}
              onClick={handlePickDirectory}
              className="h-6 flex-1 min-w-0 rounded border border-[#3a3466] bg-[#12101f] px-2.5 text-[11px] text-gray-300 outline-none cursor-pointer hover:border-indigo-500/60 transition-colors truncate"
              placeholder="选择工作区目录..."/>
            <button data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}} onClick={handlePickDirectory}
              className="flex h-6 shrink-0 items-center gap-1 rounded bg-indigo-600/40 px-2.5 text-[10px] font-medium text-indigo-200 hover:bg-indigo-600/60 transition-colors"> 选择目录</button>
          </div>

          {/* Minimized view - compact restore bar */}
          {windowMinimized && (
            <div data-no-drag
              className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#1a1538] to-[#181430] px-4 py-1.5 hover:from-[#241e48] transition-colors"
              onClick={handleWindowRestore}>
              <span className="text-[10px] text-gray-400">&#128187; 开发工作室 - 已最小化 (点击恢复)</span>
              <PanelControls onClose={onClose} size="xs"/>
            </div>
          )}

          {/* CONTENT ROW: File Tree + Browse/Edit Area */}
          {!windowMinimized && (
          <div className="flex min-h-0 flex-1 overflow-hidden">

            {/* RIGHT SIDEBAR: File Tree */}
            {sidebarVisible && (<div style={{width:sidebarWidth,minWidth:140,maxWidth:450}}
              className="order-first flex shrink-0 flex-col overflow-hidden border-r border-[#252045]">
              <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#1a1838] to-[#181533] px-3 py-1">
                <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={()=>setSidebarVisible(false)}
                  className="flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:text-white text-[10px]">&#9664;</button>
                <div className="flex items-center gap-1.5">
                  <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={handlePickDirectory} className="flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:text-cyan-300 text-[11px]" title="选择工作区目录">&#128193;</button>
                  <span className="text-[10px] font-bold tracking-wider text-amber-300/90 uppercase">文件资源管理器</span>
                  <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={handleRefreshFileTree} className="flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:text-cyan-300 text-[10px]" title="刷新文件树">&#8635;</button>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <PanelControls onClose={()=>setSidebarVisible(false)} size="xs"/>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5 scrollbar-thin scrollbar-thumb-[#2a2555]">
                {fileTree.map(n=>renderTreeNode(n))}
              </div>
            </div>)}

            {/* Collapsed sidebar toggle */}
            {!sidebarVisible && (<div className="order-first flex w-6 items-start justify-center pt-3 bg-[#131128]/80">
              <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={()=>setSidebarVisible(true)} className="rounded px-0.5 py-0.5 text-[10px] text-gray-500 hover:text-white hover:bg-white/10">&#9654;</button>
            </div>)}

            {/* V-SPLITTER between file tree and browse area */}
            {sidebarVisible && (<div onMouseDown={handleVSplitDown}
              className="order-first flex w-[4px] cursor-col-resize items-center justify-center bg-[#1c1838] hover:bg-indigo-600/30 group transition-colors">
              <div className="h-10 w-[3px] rounded-full bg-indigo-500/15 group-hover:bg-indigo-400/40"/></div>)}

            {/* BROWSE / EDIT AREA (main content based on active tab) */}
            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">

              {/* 编辑器 VIEW */}
              {(isEditorActive || (!isEditorActive && !isTerminalActive)) && (
              <div style={{
                height: !isTerminalActive ? (terminalMode === 'panel' ? `${editorHeightPct}%` : '100%') : undefined,
              }} className={`flex min-h-0 flex-col overflow-hidden ${!isEditorActive?'hidden':''}`}>
                {/* Editor header bar */}
                <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#1e1850] to-[#211b45] px-3 py-1">
                  <div className="flex items-center gap-1.5">
                    <span>&#128221;</span><span className="text-[11px] font-bold tracking-wider text-indigo-300 uppercase">编辑器</span>
                    <span className="text-[10px] text-indigo-400/60">代码编辑器</span>
                    {activeFile?.modified&&<span className="ml-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[9px] text-orange-400 font-medium">已修改</span>}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={handleNewFile} className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600/60 text-white hover:bg-indigo-500/70 active:scale-90 transition-transform text-[13px]" title="新建文件 (+)">+</button>
                    <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={handleRefresh} className={`flex h-5 w-5 items-center justify-center rounded text-white text-[12px] transition-colors ${activeFile?'bg-sky-700/50 hover:bg-sky-600/60 active:scale-90':'bg-sky-700/30 hover:bg-sky-600/40'}`} title="刷新 (&#8635);">&#8635;</button>
                    <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={handleSave} className={`flex h-5 w-5 items-center justify-center rounded text-white text-[12px] transition-colors ${activeFile?.modified?'bg-green-700/50 hover:bg-green-600/60 active:scale-90 animate-pulse':'bg-green-700/30 hover:bg-green-600/40'}`} title="保存 (&#128190);">&#128190;</button>
                    <PanelControls onClose={handleEditorClose}/>
                  </div>
                </div>

                {/* Editor toolbar */}
                <div className="flex shrink-0 items-center gap-1.5 border-b border-[#231e42] bg-[#181532] px-2.5 py-1 relative">
                  <select defaultValue={activeFile?.language||'javascript'} onChange={(e)=>{ if(activeFile) setOpenFiles(p=>p.map(f=>f.id===activeFileId?{...f,language:e.target.value}:f)) }} className="h-6 rounded border border-[#3a3466] bg-[#12101f] px-2 text-[11px] text-gray-300 outline-none cursor-pointer">
                    {LANGUAGES.map(l=><option key={l}>{l}</option>)}
                  </select>
                  <input readOnly value={activeFile?.path||'（无文件）'} className="h-6 flex-1 min-w-0 rounded border border-[#323058] bg-[#12101f] px-2.5 text-[11px] text-gray-400 outline-none truncate"/>
                  <div className="relative">
                    <button data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}} onClick={handleSelectFile} className="flex h-6 shrink-0 items-center gap-1 rounded border border-[#3a3466] bg-[#1e1b38] px-2 text-[10px] text-indigo-300 hover:border-indigo-500 active:bg-indigo-600/20 transition-colors">&#128193; 选择文件</button>
                    {showFilePicker && (
                      <div data-no-drag onMouseDown={e=>e.stopPropagation()} className="absolute top-full left-0 z-50 mt-1 w-[260px] max-h-[280px] rounded-lg border border-[#3a3466] bg-[#161330] shadow-xl overflow-hidden">
                        <div className="flex items-center gap-1.5 border-b border-[#2d2652] px-2.5 py-1.5 bg-gradient-to-r from-[#1e1850]/80 to-[#1c1840]/80">
                          <span className="text-[10px] font-semibold text-amber-300/90 uppercase tracking-wider">从工作区选择文件</span>
                          <button onClick={()=>setShowFilePicker(false)} className="ml-auto flex h-4 w-4 items-center justify-center rounded text-[10px] text-gray-500 hover:text-white">&#215;</button>
                        </div>
                        <div className="max-h-[240px] overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-[#2a2555]">
                          {fileTree.map(n=>{
                            function renderPickNode(node: FileNode, depth = 0) {
                              return (
                                <div key={node.path}>
                                  <div style={{paddingLeft:`${depth*12+8}px`}}
                                    className={`group flex cursor-pointer items-center gap-1.5 px-1.5 py-1 text-[11px] ${node.type==='directory'?'hover:bg-white/8 text-yellow-300/90':'hover:bg-blue-400/10 text-gray-300 hover:text-blue-300'}`}
                                    onClick={()=>handlePickFromFileTree(node)}>
                                    <span className="shrink-0 text-[10px]">{node.type==='directory'?'\u{1F4C1}':'\u{1F4C4}'}</span>
                                    <span className="truncate">{node.name}</span>
                                  </div>
                                  {node.type==='directory'&&node.children?.map(c=>renderPickNode(c,depth+1))}
                                </div>
                              )
                            }
                            return renderPickNode(n)
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <button data-no-drag onClick={()=>setEditorVimMode(v=>!v)} className={`flex h-6 shrink-0 items-center gap-1 rounded border px-2 text-[10px] transition-colors ${editorVimMode?'border-green-600/60 bg-green-900/30 text-green-400':'border-[#3a3466] bg-[#1e1b38] text-gray-400 hover:border-indigo-500'}`} title="Vim 模式">{editorVimMode?'\u2713':' '}Vim</button>
                </div>

                {/* Code area */}
                <div className="min-h-0 flex-1 overflow-hidden bg-[#0c0a18] p-0">
                  {activeFile ? (
                    <MonacoEditorPanel
                      files={openFiles.map(f => ({ id: f.id, name: f.name, path: f.path, content: f.content, language: f.language, modified: f.modified }))}
                      activeFileId={activeFileId || ''}
                      onActiveFileChange={setActiveFileId}
                      onFileChange={(fileId, value) => setOpenFiles(p => p.map(f => f.id === fileId ? { ...f, content: value, modified: true } : f))}
                      onFileSave={(_fileId) => handleSave()}
                      onFileClose={(fileId) => {
                        setOpenFiles(prev => {
                          const next = prev.filter(f => f.id !== fileId)
                          if (fileId === activeFileId) {
                            const nextActive = next.length > 0 ? next[next.length - 1] : undefined
                            setActiveFileId(nextActive ? nextActive.id : null)
                          }
                          return next
                        })
                      }}
                      onOpenFile={(filePath) => {
                        const name = filePath.split(/[\\/]/).pop() || filePath
                        const ext = name.split('.').pop()?.toLowerCase() || ''
                        const langMap: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', rs: 'rust', go: 'go', json: 'json', md: 'markdown', css: 'css', html: 'html', yaml: 'yaml', yml: 'yaml', sql: 'sql', sh: 'shell', java: 'java', c: 'c', cpp: 'cpp' }
                        const language = langMap[ext] || 'plaintext'
                        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`
                        setOpenFiles(prev => [...prev, { id, name, path: filePath, content: '', language, modified: false }])
                        setActiveFileId(id)
                      }}
                      workDir={workspacePath || cwd}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-gray-600">双击文件资源管理器中的文件即可在编辑器中打开</div>
                  )}
                </div>
              </div>
              )}

              {/* H-SPLITTER: Editor <-> Terminal (only in panel mode when both visible) */}
              {isEditorActive && terminalMode === 'panel' && (
                <div onMouseDown={handleHSplitDown}
                  className="flex shrink-0 h-[5px] cursor-row-resize items-center justify-center bg-[#1c1838] hover:bg-indigo-600/30 group transition-colors z-10 relative">
                  <div className="w-10 h-[3px] rounded-full bg-indigo-500/20 group-hover:bg-indigo-400/50 transition-colors"/>
                  <span className="absolute text-[8px] text-gray-600 group-hover:text-gray-400 transition-colors select-none">&#8744;</span>
                </div>
              )}

              {/* TERMINAL VIEW */}
              {(isTerminalActive || terminalMode === 'panel') && (
              <div style={{
                height: isTerminalActive
                  ? '100%'
                  : terminalMode === 'panel'
                    ? `${100 - editorHeightPct}%`
                    : '0%',
                display: terminalMode === 'hidden' && !isTerminalActive ? 'none' : 'flex',
                minHeight: terminalMode === 'panel' && !isTerminalActive ? '80px' : undefined,
              }} className={`flex min-h-0 flex-col overflow-hidden border-t border-[#231e42] transition-all duration-150 ${isTerminalActive?'!border-t-0':''}`}>
                {/* Terminal header */}
                <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#151840] to-[#18163a] px-3 py-1">
                  <div className="flex items-center gap-1.5">
                    <span>&#128427;</span><span className="text-[11px] font-bold tracking-wider text-cyan-300 uppercase">终端</span>
                    <span className="text-[10px] text-cyan-400/50">命令执行</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <button data-no-drag onClick={()=>setTerminalVimMode(v=>!v)} className={`flex h-6 shrink-0 items-center gap-1 rounded border px-2 text-[10px] transition-colors ${terminalVimMode?'border-green-600/60 bg-green-900/30 text-green-400':'border-[#3a3466] bg-[#1e1b38] text-gray-400 hover:border-indigo-500'}`} title="Vim 模式">{terminalVimMode?'\u2713':' '}Vim</button>
                    <button data-no-drag onMouseDown={e=>e.stopPropagation()}
                      onClick={()=>{if(isTerminalActive){setTerminalMode('panel')}else{setTerminalMode('full');const tMod=modules.find(m=>m.type==='terminal');if(tMod)setActiveModuleId(tMod.id)}}}
                      className={`rounded px-2 text-[10px] transition-colors ${terminalMode!=='panel'||isTerminalActive?'bg-[#252048] text-gray-400 hover:text-cyan-300':'bg-cyan-800/50 text-cyan-300'}`}
                      title={isTerminalActive?"最小化（显示在下方）":"最小化"}>-</button>
                    <button data-no-drag onMouseDown={e=>e.stopPropagation()}
                      onClick={()=>setTerminalMode(isTerminalActive&&terminalMode==='full'?'panel':'full')}
                      className="flex items-center gap-1 rounded px-2 text-[10px] transition-colors bg-[#252048] text-gray-400 hover:text-cyan-300"
                      title="最大化填充视图">&#9650;</button>
                    <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={()=>{
                      setTerminalMode('hidden')
                      if (isTerminalActive) { const nonTermMod = modules.find(m => m.type !== 'terminal'); if (nonTermMod) setActiveModuleId(nonTermMod!.id) }
                    }} className="rounded px-2 text-[10px] bg-[#252048] text-gray-400 hover:text-cyan-300" title="隐藏">&#215;</button>
                  </div>
                </div>

                {/* Terminal sub-tabs */}
                <div className="flex shrink-0 items-center border-b border-[#231e42] bg-[#181532] px-1.5">
                  {(['console','problems','output','debug','terminal'] as TerminalTabType[]).map(tab=>{
                    const lbl:{[k in TerminalTabType]:string}={console:'控制台',problems:'问题',output:'输出',debug:'调试',terminal:'终端'}
                    const dot = tab==='console'||tab==='problems'
                    return(
                      <button key={tab} data-no-drag onMouseDown={e=>e.stopPropagation()}
                        onClick={()=>{setTerminalTab(tab);setShowSettings(false);setShowNewTermMenu(false)}}
                        className={`relative shrink-0 rounded-t px-2.5 py-1 text-[10px] transition-colors ${terminalTab===tab?'bg-[#282350] text-white font-medium':'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}>
                        {lbl[tab]}
                        {dot&&<span className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-red-400"/>}
                      </button>)
                  })}
                  <div className="ml-auto flex items-center gap-0.5" style={{flexShrink:0}}>
                    <div className="relative">
                      <button ref={newTermBtnRef} data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}}
                        onClick={()=>{setShowNewTermMenu(v=>!v);setShowSettings(false)}} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-white/10 hover:text-white text-[15px] font-light" title="新建终端">+</button>
                      {showNewTermMenu&&(<div data-no-drag onMouseDown={e=>e.stopPropagation()}
                        className="fixed z-[9999] min-w-[180px] rounded-lg border border-[#3a3466] bg-[#1c1938] py-1 shadow-xl"
                        style={{top:`${newTermMenuPos.top}px`,left:`${newTermMenuPos.left}px`}}>
                        {(Object.entries(TERMINAL_TYPE_LABELS)as[TerminalType,string][]).map(([k,l])=>
                          <button key={k} onClick={()=>addTerminal(k)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11px] text-gray-300 hover:bg-indigo-600/25 hover:text-white">
                            <span>{TERMINAL_TYPE_ICONS[k]}</span><span>{l}</span>
                          </button>)}
                      </div>)}
                    </div>
                    <div className="relative">
                      <button ref={settingsBtnRef} data-no-drag onMouseDown={e=>{e.stopPropagation();e.preventDefault()}}
                        onClick={()=>{setShowSettings(v=>!v);setShowNewTermMenu(false)}} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-white/10 hover:text-white text-[13px]" title="问题日志设置">&#9881;</button>
                      {showSettings&&(<div data-no-drag onMouseDown={e=>e.stopPropagation()}
                        className="fixed z-[9999] w-[200px] rounded-lg border border-[#3a3466] bg-[#1c1938] py-1.5 px-3 shadow-xl"
                        style={{top:`${settingsMenuPos.top}px`,right:`${settingsMenuPos.right}px`}}>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">日志级别</div>
                        {[{k:'error',i:'❌',l:'错误',c:'text-red-400'},{k:'warning',i:'⚠',l:'警告',c:'text-yellow-400'},{k:'info',i:'ℹ',l:'信息',c:'text-cyan-400'}].map(it=>
                          <label key={it.k} className="flex cursor-pointer items-center gap-2 py-1.5 text-[11px]">
                            <input type="checkbox" checked={logLevels[it.k as keyof typeof logLevels]}
                              onChange={e=>setLogLevels(p=>({...p,[it.k]:e.target.checked}))} className="h-3 w-3 rounded accent-indigo-500"/>
                            <span className={it.c}>{it.i}</span><span className="text-gray-300">{it.l}</span>
                          </label>)}
                        <div className="border-t border-[#3a3466] my-1.5 pt-1.5">
                          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">终端操作</div>
                          <button data-no-drag onMouseDown={e=>e.stopPropagation()}
                            onClick={()=>{const ref=termRefs.current.get(activeTerminalId);if(ref){try{ref.term.clear()}catch{}};setShowSettings(false)}}
                            className="flex w-full items-center gap-2 py-1.5 text-[11px] text-gray-300 hover:text-white hover:bg-indigo-600/25 rounded px-1 transition-colors">
                            <span>🗑</span><span>清空终端</span>
                          </button>
                          <button data-no-drag onMouseDown={e=>e.stopPropagation()}
                            onClick={()=>{const ref=termRefs.current.get(activeTerminalId);if(ref){try{ref.fit.fit()}catch{}};setShowSettings(false)}}
                            className="flex w-full items-center gap-2 py-1.5 text-[11px] text-gray-300 hover:text-white hover:bg-indigo-600/25 rounded px-1 transition-colors">
                            <span>📐</span><span>重新适配大小</span>
                          </button>
                          <button data-no-drag onMouseDown={e=>e.stopPropagation()}
                            onClick={()=>{removeTerminal(activeTerminalId);setShowSettings(false)}}
                            className="flex w-full items-center gap-2 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-600/15 rounded px-1 transition-colors">
                            <span>✕</span><span>关闭当前终端</span>
                          </button>
                        </div>
                      </div>)}
                    </div>
                  </div>
                </div>

                {/* Terminal body */}
                <div className="flex min-h-0 flex-1 overflow-hidden bg-[#0a0914]">
                  {/* 根据选中的标签显示不同内容 */}
                  {terminalTab === 'terminal' && (
                    <>
                      <div className="min-h-0 flex-1 overflow-hidden relative">
                        {terminals.map(t => (
                          <div key={t.id} id={`xterm-${t.id}`} className="h-full w-full absolute inset-0"
                            style={{ display: t.id === activeTerminalId ? 'block' : 'none' }} />
                        ))}
                      </div>
                      {terminals.length > 1 && (
                        <div className="flex w-[160px] shrink-0 flex-col border-l border-[#252045] bg-[#111024]">
                          {terminals.map(t=>
                            <div key={t.id} onClick={()=>{setActiveTerminalId(t.id);setTerminals(p=>p.map(x=>({...x,active:x.id===t.id})))}}
                              className={`group flex cursor-pointer items-center gap-1.5 border-b border-[#1e1a35] px-2 py-1.5 text-[10px] transition-colors ${t.active?'bg-indigo-600/25 text-white':'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}>
                              <span className="shrink-0 text-[12px]">{TERMINAL_TYPE_ICONS[t.type]}</span>
                              <span className="min-w-0 flex-1 truncate">{t.name}</span>
                              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                                <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();restartTerminal(t.id)}} className="flex h-4 w-4 items-center justify-center rounded hover:bg-white/10 text-[9px] text-green-400" title="刷新终端">&#8635;</button>
                                <button data-no-drag onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();removeTerminal(t.id)}} className="flex h-4 w-4 items-center justify-center rounded hover:bg-red-500/30 text-[9px] text-red-400" title="关闭终端">&#215;</button>
                              </div>
                            </div>)}
                        </div>
                      )}
                    </>
                  )}
                  {terminalTab === 'console' && (
                    <div className="flex-1 overflow-auto p-4 font-mono text-[11px] text-gray-300">
                      <div className="text-gray-500 mb-2">=== 控制台输出 ===</div>
                      <div className="text-green-400">[INFO] 系统初始化完成</div>
                      <div className="text-green-400">[INFO] 终端服务已启动</div>
                      <div className="text-blue-400">[DEBUG] 工作目录: {cwd || '未设置'}</div>
                      <div className="text-gray-400">{`>`} 等待命令输入...</div>
                    </div>
                  )}
                  {terminalTab === 'problems' && (
                    <div className="flex-1 overflow-auto p-4">
                      <div className="text-[11px] text-gray-500 mb-2">=== 问题面板 ===</div>
                      <div className="flex items-center gap-2 p-2 rounded bg-[#1c1938] text-[11px] text-gray-400">
                        <span className="text-green-400">&#10003;</span>
                        <span>未发现问题</span>
                      </div>
                    </div>
                  )}
                  {terminalTab === 'output' && (
                    <div className="flex-1 overflow-auto p-4 font-mono text-[11px]">
                      <div className="text-gray-500 mb-2">=== 构建输出 ===</div>
                      <div className="text-gray-300">构建成功完成</div>
                      <div className="text-gray-400 mt-2">耗时: 0.00s</div>
                    </div>
                  )}
                  {terminalTab === 'debug' && (
                    <div className="flex-1 overflow-auto p-4">
                      <div className="text-[11px] text-gray-500 mb-2">=== 调试面板 ===</div>
                      <div className="text-[11px] text-gray-400">调试器未连接</div>
                      <div className="text-[10px] text-gray-500 mt-2">请启动调试会话以查看变量和调用堆栈</div>
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Other module placeholders */}
              {(activeModuleType !== 'editor' && activeModuleType !== 'terminal') && renderOtherModuleView()}

            </div>{/* end BROWSE/EDIT AREA */}

          </div>
          )}{/* end CONTENT ROW */}

        {/* Resize handles - only in portal mode */}
        {!isMerged && (
          <>
            <div onMouseDown={handleResizeDown('se')} className="absolute bottom-0 right-0 z-10 h-3 w-3 cursor-se-resize"/>
            <div onMouseDown={handleResizeDown('sw')} className="absolute bottom-0 left-0 z-10 h-3 w-3 cursor-sw-resize"/>
            <div onMouseDown={handleResizeDown('ne')} className="absolute top-0 right-0 z-10 h-3 w-3 cursor-ne-resize"/>
            <div onMouseDown={handleResizeDown('nw')} className="absolute top-0 left-0 z-10 h-3 w-3 cursor-nw-resize"/>
            <div onMouseDown={handleResizeDown('s')} className="absolute bottom-0 left-3 right-3 z-10 h-1.5 cursor-s-resize"/>
            <div onMouseDown={handleResizeDown('n')} className="absolute top-0 left-3 right-3 z-10 h-1.5 cursor-n-resize"/>
            <div onMouseDown={handleResizeDown('e')} className="absolute top-3 bottom-3 right-0 z-10 w-1.5 cursor-e-resize"/>
            <div onMouseDown={handleResizeDown('w')} className="absolute top-3 bottom-3 left-0 z-10 w-1.5 cursor-w-resize"/>
          </>
        )}
    </>
  )

  return (
    <>
      <button onClick={onToggle} title="Terminal"
        className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]">
        <span className="material-symbols-outlined text-[18px]">terminal</span>
      </button>

      {isMerged ? (
        /* MERGED MODE: right sidebar panel via Portal */
        (typeof document !== 'undefined') && document?.body && createPortal(
          <div className="fixed top-0 right-0 z-[100] flex flex-col overflow-hidden border-l border-indigo-600/40 bg-[#131128] shadow-xl"
            style={{width:size.w, height:'calc(100vh - 56px)', top:'56px'}}
            onMouseDown={(e)=>{ e.stopPropagation(); setShowNewTermMenu(false); setShowSettings(false) }}>
            {windowMinimized ? (
              <div className="flex h-full items-center justify-center bg-[#131128]">
                <button data-no-drag onClick={handleWindowRestore}
                  className="rounded-lg border border-indigo-500/40 bg-indigo-600/15 px-4 py-2 text-xs text-indigo-300 hover:bg-indigo-600/25 transition-colors">
                  开发工作室 - 已最小化 (点击恢复)
                </button>
              </div>
            ) : studioContent}
          </div>,
          document.body
        )
      ) : (
        /* PORTAL MODE: floating window */
        (typeof document !== 'undefined') && document?.body && createPortal(
          <div ref={containerRef}
            style={{left:pos.x, top:pos.y, width:size.w, height:size.h}}
            className="fixed z-[9999] flex flex-col overflow-hidden rounded-lg border border-indigo-600/50 bg-[#131128] shadow-2xl shadow-black/60"
            onMouseDown={(e)=>{ e.stopPropagation(); setShowNewTermMenu(false); setShowSettings(false) }}>
            {studioContent}
          </div>,
          document.body
        )
      )}
    </>
  )
}

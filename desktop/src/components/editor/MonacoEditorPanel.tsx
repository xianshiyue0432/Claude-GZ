import { useCallback, useRef, useEffect, useState } from 'react'
import Editor, { OnMount, OnChange, loader } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'

const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs'

if (typeof window !== 'undefined') {
  const isTauri = '__TAURI_INTERNALS__' in window || !window.location.protocol.startsWith('http')

  if (isTauri) {
    loader.config({ paths: { vs: MONACO_CDN } })
  } else {
    ;(window as any).MonacoEnvironment = {
      getWorkerUrl: function (_moduleId: string, label: string) {
        if (label === 'json') {
          return new URL(/* @vite-ignore */ 'monaco-editor/esm/vs/language/json/json.worker?worker', import.meta.url).href
        }
        if (label === 'css' || label === 'scss' || label === 'less') {
          return new URL(/* @vite-ignore */ 'monaco-editor/esm/vs/language/css/css.worker?worker', import.meta.url).href
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return new URL(/* @vite-ignore */ 'monaco-editor/esm/vs/language/html/html.worker?worker', import.meta.url).href
        }
        if (label === 'typescript' || label === 'javascript') {
          return new URL(/* @vite-ignore */ 'monaco-editor/esm/vs/language/typescript/ts.worker?worker', import.meta.url).href
        }
        return new URL(/* @vite-ignore */ 'monaco-editor/esm/vs/editor/editor.worker?worker', import.meta.url).href
      },
    }
  }
}

type EditorFile = {
  id: string
  name: string
  path: string
  content: string
  language: string
  modified: boolean
}

type Props = {
  files: EditorFile[]
  activeFileId: string
  onActiveFileChange: (id: string) => void
  onFileChange: (fileId: string, value: string) => void
  onFileSave: (fileId: string) => void
  onFileClose: (fileId: string) => void
  onOpenFile: (path: string) => void
  workDir?: string
}

type SplitView = 'none' | 'right'

export function MonacoEditorPanel({
  files, activeFileId, onActiveFileChange, onFileChange, onFileSave, onFileClose, onOpenFile, workDir,
}: Props) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const secondEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [splitView, setSplitView] = useState<SplitView>('none')
  const [splitFileId, setSplitFileId] = useState<string>('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ file: string; path: string; line: number; text: string }>>([])
  const [showMinimap, setShowMinimap] = useState(true)
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('off')
  const [fontSize, setFontSize] = useState(13)

  const activeFile = files.find(f => f.id === activeFileId)
  const splitFile = files.find(f => f.id === splitFileId)

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFileId) onFileSave(activeFileId)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      editor.getAction('actions.find')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      editor.getAction('editor.action.startFindReplaceAction')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
      editor.getAction('editor.action.gotoLine')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      setShowSearch(true)
    })
    editor.focus()
  }, [activeFileId, onFileSave])

  const handleSecondEditorMount: OnMount = useCallback((editor, monaco) => {
    secondEditorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (splitFileId) onFileSave(splitFileId)
    })
  }, [splitFileId, onFileSave])

  const handleEditorChange: OnChange = useCallback((value) => {
    if (activeFileId && value !== undefined) {
      onFileChange(activeFileId, value)
    }
  }, [activeFileId, onFileChange])

  const handleSecondEditorChange: OnChange = useCallback((value) => {
    if (splitFileId && value !== undefined) {
      onFileChange(splitFileId, value)
    }
  }, [splitFileId, onFileChange])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !workDir) return
    try {
      const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
      const results: Array<{ file: string; path: string; line: number; text: string }> = []
      const searchInDir = async (dir: string) => {
        try {
          const entries = await readDir(dir)
          for (const entry of entries) {
            const entryPath = `${dir}/${entry.name}`
            if (entry.isDirectory) {
              const skip = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target']
              if (!skip.includes(entry.name || '')) await searchInDir(entryPath)
            } else {
              const ext = entry.name?.split('.').pop()?.toLowerCase() || ''
              const textExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'json', 'md', 'css', 'html', 'yaml', 'yml', 'toml', 'sql', 'sh', 'xml', 'java', 'c', 'cpp', 'h', 'txt', 'svelte', 'vue']
              if (textExts.includes(ext)) {
                try {
                  const content = await readTextFile(entryPath)
                  const lines = content.split('\n')
                  lines.forEach((line, idx) => {
                    if (line.toLowerCase().includes(searchQuery.toLowerCase())) {
                      results.push({ file: entry.name || '', path: entryPath, line: idx + 1, text: line.trim().slice(0, 120) })
                    }
                  })
                } catch {}
              }
            }
          }
        } catch {}
      }
      await searchInDir(workDir)
      setSearchResults(results.slice(0, 100))
    } catch (err) {
      console.error('Search failed:', err)
    }
  }, [searchQuery, workDir])

  const toggleSplit = useCallback((fileId?: string) => {
    if (splitView === 'none') {
      setSplitView('right')
      setSplitFileId(fileId || activeFileId)
    } else {
      setSplitView('none')
      setSplitFileId('')
    }
  }, [splitView, activeFileId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        setShowSearch(s => !s)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: showMinimap },
    fontSize,
    wordWrap,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on',
    tabSize: 2,
    insertSpaces: true,
    formatOnPaste: true,
    formatOnType: true,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 8 },
    lineNumbers: 'on',
    glyphMargin: true,
    folding: true,
    links: true,
    colorDecorators: true,
    contextmenu: true,
    find: { addExtraSpaceOnTop: true, autoFindInSelection: 'never' },
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-indigo-600/20 bg-[#0d0b1f]/60 px-2 py-1">
        <button onClick={() => setShowMinimap(v => !v)} title={showMinimap ? '隐藏缩略图' : '显示缩略图'}
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="material-symbols-outlined text-[14px]">map</span>
        </button>
        <button onClick={() => setWordWrap(v => v === 'on' ? 'off' : 'on')} title={wordWrap === 'on' ? '关闭自动换行' : '开启自动换行'}
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="material-symbols-outlined text-[14px]">wrap_text</span>
        </button>
        <button onClick={() => setFontSize(s => Math.min(24, s + 1))} title="增大字号"
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="material-symbols-outlined text-[14px]">text_increase</span>
        </button>
        <button onClick={() => setFontSize(s => Math.max(8, s - 1))} title="减小字号"
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="material-symbols-outlined text-[14px]">text_decrease</span>
        </button>
        <div className="mx-1 h-3 w-px bg-gray-700" />
        <button onClick={() => toggleSplit()} title={splitView === 'none' ? '分屏对比' : '关闭分屏'}
          className={`rounded px-1.5 py-0.5 text-[10px] ${splitView !== 'none' ? 'text-indigo-300 bg-indigo-600/20' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}>
          <span className="material-symbols-outlined text-[14px]">vertical_split</span>
        </button>
        <button onClick={() => setShowSearch(s => !s)} title="搜索文件 (Ctrl+P)"
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="material-symbols-outlined text-[14px]">search</span>
        </button>
        {activeFile && (
          <>
            <div className="mx-1 h-3 w-px bg-gray-700" />
            <span className="text-[10px] text-gray-500">{activeFile.path}</span>
            {activeFile.modified && <span className="ml-1 text-[10px] text-yellow-400">●</span>}
          </>
        )}
      </div>

      {/* File tabs */}
      <div className="flex items-center border-b border-indigo-600/15 bg-[#0d0b1f]/40 px-1">
        <div className="flex flex-1 items-center overflow-x-auto">
          {files.map(f => (
            <div key={f.id}
              className={`group flex shrink-0 items-center gap-1 border-r border-indigo-600/10 px-2.5 py-1 text-[11px] cursor-pointer transition-colors ${
                f.id === activeFileId ? 'bg-[#1e1b3a] text-indigo-200 border-b-2 border-b-indigo-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/3'
              }`}
              onClick={() => onActiveFileChange(f.id)}>
              <span className="material-symbols-outlined text-[12px]">{getFileIcon(f.language)}</span>
              <span>{f.name}</span>
              {f.modified && <span className="text-[8px] text-yellow-400">●</span>}
              <button onClick={e => { e.stopPropagation(); onFileClose(f.id) }}
                className="ml-0.5 rounded p-0.5 text-[10px] text-gray-600 opacity-0 hover:bg-white/10 hover:text-gray-300 group-hover:opacity-100">
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Search panel */}
      {showSearch && (
        <div className="border-b border-indigo-600/20 bg-[#0d0b1f]/80 px-3 py-2">
          <div className="flex items-center gap-2">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="搜索文件内容... (Enter 搜索)"
              className="flex-1 rounded border border-indigo-600/30 bg-[#1e1b3a] px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-indigo-400/50" />
            <button onClick={handleSearch} className="rounded bg-indigo-600/30 px-2 py-1 text-[10px] text-indigo-200 hover:bg-indigo-600/40">
              搜索
            </button>
            <button onClick={() => { setShowSearch(false); setSearchResults([]) }} className="rounded px-2 py-1 text-[10px] text-gray-400 hover:bg-white/5">
              关闭
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-auto">
              {searchResults.map((r, i) => (
                <div key={i} onClick={() => onOpenFile(r.path)}
                  className="flex items-center gap-2 rounded px-2 py-0.5 text-[10px] hover:bg-white/5 cursor-pointer">
                  <span className="text-indigo-300">{r.file}</span>
                  <span className="text-gray-600">:{r.line}</span>
                  <span className="flex-1 truncate text-gray-400">{r.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editor area */}
      <div className="flex flex-1 overflow-hidden">
        {activeFile ? (
          <>
            <div className={`flex flex-col ${splitView !== 'none' ? 'w-1/2 border-r border-indigo-600/20' : 'flex-1'}`}>
              <Editor
                height="100%"
                language={activeFile.language}
                value={activeFile.content}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme="vs-dark"
                options={editorOptions}
                path={`/editor/${activeFile.name}`}
              />
            </div>
            {splitView === 'right' && splitFile && (
              <div className="flex w-1/2 flex-col">
                <div className="flex items-center gap-1 border-b border-indigo-600/15 bg-[#0d0b1f]/40 px-2 py-0.5">
                  <span className="text-[10px] text-gray-500">{splitFile.name}</span>
                  <button onClick={() => setSplitView('none')}
                    className="ml-auto rounded px-1 py-0.5 text-[10px] text-gray-500 hover:bg-white/5 hover:text-gray-300">
                    关闭
                  </button>
                </div>
                <Editor
                  height="100%"
                  language={splitFile.language}
                  value={splitFile.content}
                  onChange={handleSecondEditorChange}
                  onMount={handleSecondEditorMount}
                  theme="vs-dark"
                  options={editorOptions}
                  path={`/editor/${splitFile.name}`}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-gray-600">
            双击文件资源管理器中的文件即可在编辑器中打开
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 border-t border-indigo-600/20 bg-[#0d0b1f] px-3 py-0.5">
        <span className="text-[10px] text-gray-500">{activeFile?.language || 'plaintext'}</span>
        <span className="text-[10px] text-gray-600">UTF-8</span>
        <span className="text-[10px] text-gray-600">空格: 2</span>
        <span className="text-[10px] text-gray-600">字号: {fontSize}</span>
        {activeFile?.modified && <span className="text-[10px] text-yellow-400">已修改</span>}
      </div>
    </div>
  )
}

function getFileIcon(language: string): string {
  const icons: Record<string, string> = {
    typescript: 'code',
    javascript: 'code',
    python: 'code',
    rust: 'code',
    go: 'code',
    json: 'data_object',
    markdown: 'article',
    css: 'palette',
    html: 'html',
    yaml: 'settings',
    shell: 'terminal',
    sql: 'database',
    java: 'code',
    cpp: 'code',
    c: 'code',
    xml: 'code',
  }
  return icons[language] || 'description'
}

import { useState, useCallback, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

type Props = {
  workDir?: string
  onOpenFile?: (path: string) => void
}

type DocTab = 'preview' | 'source' | 'split'

type DocFile = {
  name: string
  path: string
  content: string
  type: 'markdown' | 'text' | 'pdf' | 'image' | 'other'
}

const SAMPLE_DOCS: DocFile[] = [
  {
    name: 'README.md',
    path: '/README.md',
    type: 'markdown',
    content: `# 项目文档

## 概述

这是一个基于 Tauri + React 的桌面 IDE 应用，支持代码编辑、终端执行、文档查看等功能。

## 功能特性

- **代码编辑器** - 基于 Monaco Editor，支持语法高亮、代码补全
- **终端** - 集成 PowerShell/Bash 终端
- **浏览器** - 内嵌浏览器预览
- **文档** - Markdown 文档查看与编辑
- **代码版本** - Git 版本控制集成

## 快速开始

\`\`\`bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 构建生产版本
bun run build
\`\`\`

## 技术栈

| 技术 | 用途 |
|------|------|
| Tauri v2 | 桌面应用框架 |
| React 19 | UI 框架 |
| TypeScript | 类型安全 |
| Monaco Editor | 代码编辑 |
| xterm.js | 终端模拟 |
| Zustand | 状态管理 |
`,
  },
  {
    name: 'CHANGELOG.md',
    path: '/CHANGELOG.md',
    type: 'markdown',
    content: `# 更新日志

## v0.1.7

- 新增浏览器模块
- 新增文档查看模块
- 新增代码版本(Git)模块
- 修复重复标签页问题
- 优化弹出窗口布局

## v0.1.6

- 集成 Monaco Editor
- 支持终端弹出为独立窗口
- 新增文件资源管理器

## v0.1.5

- 初始版本发布
- 基础代码编辑功能
- 终端集成
`,
  },
]

export function DocumentModule({ workDir: _workDir }: Props) {
  const [docs, setDocs] = useState<DocFile[]>(SAMPLE_DOCS)
  const [activeDocPath, setActiveDocPath] = useState(SAMPLE_DOCS[0]!.path)
  const [docTab, setDocTab] = useState<DocTab>('preview')
  const [editContent, setEditContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const activeDoc = docs.find(d => d.path === activeDocPath)

  useEffect(() => {
    if (activeDoc) {
      setEditContent(activeDoc.content)
    }
  }, [activeDoc])

  const handleOpenFile = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'Documents', extensions: ['md', 'txt', 'json', 'yaml', 'yml', 'toml', 'csv'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      for (const filePath of paths) {
        const name = filePath.split(/[\\/]/).pop() || 'unknown'
        const ext = name.split('.').pop()?.toLowerCase() || ''
        let type: DocFile['type'] = 'other'
        if (['md', 'markdown'].includes(ext)) type = 'markdown'
        else if (['txt', 'log'].includes(ext)) type = 'text'
        else if (ext === 'pdf') type = 'pdf'
        else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) type = 'image'
        else type = 'text'

        try {
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          const content = await readTextFile(filePath)
          const newDoc: DocFile = { name, path: filePath, content, type }
          setDocs(prev => {
            const existing = prev.findIndex(d => d.path === filePath)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = newDoc
              return updated
            }
            return [...prev, newDoc]
          })
          setActiveDocPath(filePath)
        } catch {
          const newDoc: DocFile = { name, path: filePath, content: `[无法读取文件: ${name}]`, type: 'other' }
          setDocs(prev => [...prev, newDoc])
          setActiveDocPath(filePath)
        }
      }
    } catch {}
  }, [])

  const handleSaveDoc = useCallback(async () => {
    if (!activeDoc || activeDoc.path.startsWith('/')) return
    try {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(activeDoc.path, editContent)
      setDocs(prev => prev.map(d => d.path === activeDoc.path ? { ...d, content: editContent } : d))
    } catch {}
  }, [activeDoc, editContent])

  const handleCloseDoc = useCallback((path: string) => {
    setDocs(prev => {
      const remaining = prev.filter(d => d.path !== path)
      if (activeDocPath === path && remaining.length > 0) {
        setActiveDocPath(remaining[remaining.length - 1]!.path)
      }
      return remaining
    })
  }, [activeDocPath])

  const renderMarkdown = useCallback((content: string) => {
    try {
      const html = marked.parse(content, { async: false }) as string
      return DOMPurify.sanitize(html)
    } catch {
      return DOMPurify.sanitize(content)
    }
  }, [])

  const filteredDocs = searchQuery
    ? docs.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : docs

  return (
    <div className="flex h-full bg-[#0c0a18]">
      {/* Document sidebar */}
      <div className="flex w-[180px] shrink-0 flex-col border-r border-[#252045] bg-[#111024]">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[#2d2652] bg-gradient-to-r from-[#1a1838] to-[#181533] px-2 py-1">
          <span className="text-[10px] font-bold tracking-wider text-purple-300/90 uppercase">文档列表</span>
          <button onClick={handleOpenFile}
            className="ml-auto flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:text-purple-300 text-[10px]"
            title="打开文件">+</button>
        </div>
        <div className="px-1.5 py-1">
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="h-5 w-full rounded border border-[#3a3466] bg-[#12101f] px-1.5 text-[10px] text-gray-300 outline-none"
            placeholder="搜索文档..." />
        </div>
        <div className="flex-1 overflow-y-auto py-0.5">
          {filteredDocs.map(doc => (
            <div key={doc.path}
              onClick={() => { setActiveDocPath(doc.path); setEditContent(doc.content) }}
              className={`group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[11px] transition-colors ${
                activeDocPath === doc.path ? 'bg-purple-600/20 text-purple-200' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`}>
              <span className="shrink-0 text-[10px]">
                {doc.type === 'markdown' ? '📝' : doc.type === 'pdf' ? '📕' : doc.type === 'image' ? '🖼️' : '📄'}
              </span>
              <span className="truncate flex-1">{doc.name}</span>
              <button onClick={e => { e.stopPropagation(); handleCloseDoc(doc.path) }}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-[9px] text-gray-500 hover:text-red-400 transition-opacity"
                title="关闭">&#215;</button>
            </div>
          ))}
        </div>
      </div>

      {/* Document content area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Doc header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#1e1850] to-[#211b45] px-3 py-1">
          <div className="flex items-center gap-1.5">
            <span>📄</span>
            <span className="text-[11px] font-bold tracking-wider text-purple-300 uppercase">文档</span>
            <span className="text-[10px] text-purple-400/60">{activeDoc?.name || '无文档'}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/* View mode tabs */}
            {(['preview', 'source', 'split'] as DocTab[]).map(tab => {
              const labels: Record<DocTab, string> = { preview: '预览', source: '源码', split: '分屏' }
              return (
                <button key={tab} onClick={() => setDocTab(tab)}
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    docTab === tab ? 'bg-purple-600/30 text-purple-200' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}>
                  {labels[tab]}
                </button>
              )
            })}
            <button onClick={handleSaveDoc} disabled={!activeDoc || activeDoc.path.startsWith('/')}
              className="flex h-5 items-center justify-center rounded bg-green-700/50 px-2 text-[10px] text-white hover:bg-green-600/60 disabled:opacity-30 disabled:cursor-default transition-colors"
              title="保存">💾</button>
            <button onClick={handleOpenFile}
              className="flex h-5 items-center justify-center rounded bg-indigo-600/50 px-2 text-[10px] text-white hover:bg-indigo-500/60 transition-colors"
              title="打开文件">📂</button>
          </div>
        </div>

        {/* Content */}
        {activeDoc ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Source editor */}
            {(docTab === 'source' || docTab === 'split') && (
              <div className={`${docTab === 'split' ? 'w-1/2' : 'w-full'} flex flex-col min-h-0 border-r border-[#252045]`}>
                <div className="shrink-0 px-2 py-0.5 border-b border-[#231e42] bg-[#0d0b1a]">
                  <span className="text-[9px] text-gray-600">源码编辑</span>
                </div>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="flex-1 min-h-0 w-full resize-none bg-[#0a0914] p-3 font-mono text-[12px] text-gray-300 outline-none leading-relaxed"
                  spellCheck={false}
                />
              </div>
            )}

            {/* Preview */}
            {(docTab === 'preview' || docTab === 'split') && (
              <div className={`${docTab === 'split' ? 'w-1/2' : 'w-full'} flex flex-col min-h-0 overflow-hidden`}>
                <div className="shrink-0 px-2 py-0.5 border-b border-[#231e42] bg-[#0d0b1a]">
                  <span className="text-[9px] text-gray-600">渲染预览</span>
                </div>
                {activeDoc.type === 'markdown' ? (
                  <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    <div
                      className="prose prose-sm prose-invert max-w-none text-gray-300
                        prose-headings:text-gray-100 prose-headings:font-semibold
                        prose-p:my-2 prose-p:leading-relaxed
                        prose-code:text-[13px] prose-code:text-indigo-300 prose-code:bg-indigo-900/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                        prose-pre:bg-[#12101f] prose-pre:border prose-pre:border-[#3a3466] prose-pre:rounded-lg
                        prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline
                        prose-strong:text-gray-100
                        prose-ul:my-2 prose-ol:my-2
                        prose-li:my-0.5
                        prose-table:my-2 prose-table:border-collapse
                        prose-th:bg-[#1c1938] prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-th:border prose-th:border-[#3a3466]
                        prose-td:px-3 prose-td:py-1.5 prose-td:border prose-td:border-[#3a3466]
                        prose-hr:border-[#3a3466]
                        prose-blockquote:border-indigo-500/40 prose-blockquote:text-gray-400"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(docTab !== 'preview' ? editContent : activeDoc.content) }}
                    />
                  </div>
                ) : activeDoc.type === 'pdf' ? (
                  <div className="flex-1 min-h-0">
                    <iframe src={activeDoc.path} className="h-full w-full border-0" title="PDF预览" />
                  </div>
                ) : activeDoc.type === 'image' ? (
                  <div className="flex flex-1 items-center justify-center p-4">
                    <img src={activeDoc.path} alt={activeDoc.name} className="max-h-full max-w-full object-contain" />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    <pre className="whitespace-pre-wrap font-mono text-[12px] text-gray-300 leading-relaxed">{activeDoc.content}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <span className="text-3xl">📄</span>
              <p className="mt-2 text-[11px] text-gray-500">打开或创建文档以开始查看</p>
              <button onClick={handleOpenFile}
                className="mt-3 rounded-lg border border-purple-600/40 bg-purple-600/15 px-4 py-1.5 text-[11px] text-purple-300 hover:bg-purple-600/25 transition-colors">
                打开文件
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

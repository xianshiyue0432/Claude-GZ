import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ProjectFilter } from './ProjectFilter'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { SessionListItem, MessageEntry } from '../../types/session'
import { useTabStore, SETTINGS_TAB_ID, SCHEDULED_TAB_ID, TERMINAL_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { sessionsApi } from '../../api/sessions'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

type TimeGroup = 'today' | 'yesterday' | 'older'

// 判断消息是否为有效内容（有实际文字，不只是符号）
function hasValidContent(content: unknown): boolean {
  if (!content) return false
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  // 去除空白、标点、符号后检查是否有实际文字
  const cleaned = text.replace(/[\s\p{P}\p{S}]/gu, '')
  return cleaned.length > 0
}

// 获取对话第一条消息的预览
function getFirstMessagePreview(messages: MessageEntry[]): string {
  if (messages.length === 0) return ''
  
  // 获取第一条消息
  const firstMsg = messages[0]
  if (!firstMsg) return '[无内容]'
  
  let text = ''
  
  // 处理不同格式的消息内容
  if (typeof firstMsg.content === 'string') {
    // 尝试解析 JSON 格式
    try {
      const parsed = JSON.parse(firstMsg.content)
      // 处理数组格式 [{"type":"text","text":"..."}]
      if (Array.isArray(parsed)) {
        text = parsed.map((item: {type?: string; text?: string}) => item.text || '').join('')
      } else if (parsed && typeof parsed === 'object') {
        // 处理对象格式 {"type":"text","text":"..."}
        text = parsed.text || JSON.stringify(parsed)
      } else {
        text = String(parsed)
      }
    } catch {
      // 不是 JSON，直接使用字符串
      text = firstMsg.content
    }
  } else if (Array.isArray(firstMsg.content)) {
    // 内容已经是数组
    text = firstMsg.content.map((item: {type?: string; text?: string}) => item.text || '').join('')
  } else {
    text = JSON.stringify(firstMsg.content)
  }
  
  // 返回前40个字符作为预览
  return text.slice(0, 40).replace(/\n/g, ' ') || '[无内容]'
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const addToast = useUIStore((s) => s.addToast)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const closeTab = useTabStore((s) => s.closeTab)
  const updateTabTitle = useTabStore((s) => s.updateTabTitle)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sessionMessages, setSessionMessages] = useState<Map<string, MessageEntry[]>>(new Map())
  const [expandedInvalidSessions, setExpandedInvalidSessions] = useState<Set<string>>(new Set())
  const [loadingMessages, setLoadingMessages] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    if (!contextMenu || sidebarOpen) return
    setContextMenu(null)
  }, [contextMenu, sidebarOpen])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const filteredSessions = useMemo(() => {
    let result = sessions
    // 过滤掉没有内容的对话（messageCount === 0）
    result = result.filter((s) => s.messageCount > 0)
    if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => s.title.toLowerCase().includes(q))
    }
    return result
  }, [sessions, selectedProjects, searchQuery])

  const timeGroups = useMemo(() => groupByTime(filteredSessions), [filteredSessions])

  // 加载会话消息以判断是否为有效对话
  useEffect(() => {
    const loadMessages = async () => {
      const newMessages = new Map(sessionMessages)
      const toLoad = filteredSessions.filter(s => !newMessages.has(s.id) && !loadingMessages.has(s.id))
      
      if (toLoad.length === 0) return
      
      setLoadingMessages(prev => new Set([...prev, ...toLoad.map(s => s.id)]))
      
      await Promise.all(
        toLoad.map(async (session) => {
          try {
            const { messages } = await sessionsApi.getMessages(session.id)
            newMessages.set(session.id, messages)
          } catch {
            newMessages.set(session.id, [])
          }
        })
      )
      
      setSessionMessages(newMessages)
      setLoadingMessages(prev => {
        const next = new Set(prev)
        toLoad.forEach(s => next.delete(s.id))
        return next
      })
    }
    
    loadMessages()
  }, [filteredSessions])

  // 获取排序后的分组键
  const sortedGroupKeys = useMemo(() => {
    const keys = Array.from(timeGroups.keys())
    return keys.sort((a, b) => {
      // 确保 today 和 yesterday 在最前面
      if (a === 'today') return -1
      if (b === 'today') return 1
      if (a === 'yesterday') return -1
      if (b === 'yesterday') return 1
      // 其他按日期倒序
      return b.localeCompare(a)
    })
  }, [timeGroups])

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback((id: string) => {
    setContextMenu(null)
    setPendingDeleteSessionId(id)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteSessionId) return
    await deleteSession(pendingDeleteSessionId)
    disconnectSession(pendingDeleteSessionId)
    closeTab(pendingDeleteSessionId)
    setPendingDeleteSessionId(null)
  }, [closeTab, deleteSession, disconnectSession, pendingDeleteSessionId])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setRenamingId(id)
    setRenameValue(currentTitle)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      const newTitle = renameValue.trim()
      // 更新服务器会话名称（同时更新sessionStore）
      await renameSession(renamingId, newTitle)
      // 同步更新标签栏标题，确保两侧显示一致
      updateTabTitle(renamingId, newTitle)
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameSession, updateTabTitle])

  const handleSaveSession = useCallback(async (sessionId: string) => {
    setContextMenu(null)
    try {
      const { messages } = await sessionsApi.getMessages(sessionId)
      const session = sessions.find(s => s.id === sessionId)
      const title = session?.title || '对话'
      const defaultName = `${title}_${new Date().toISOString().slice(0, 10)}.json`
      const jsonStr = JSON.stringify({ id: sessionId, title, savedAt: new Date().toISOString(), messages }, null, 2)

      if (isTauri) {
        const { documentDir, join } = await import('@tauri-apps/api/path')
        const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs')
        const docsDir = await documentDir()
        const saveDir = await join(docsDir, 'Claude-GZ-Sessions')
        // 确保目录存在
        try {
          await mkdir(saveDir, { recursive: true })
        } catch {}
        const filePath = await join(saveDir, defaultName)
        await writeFile(filePath, new TextEncoder().encode(jsonStr))
        addToast({
          type: 'success',
          message: `会话已保存至 ${filePath}`,
          duration: 5000,
        })
      } else {
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultName
        a.click()
        URL.revokeObjectURL(url)
        addToast({
          type: 'success',
          message: `会话已保存至下载文件夹: ${defaultName}`,
          duration: 3000,
        })
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : '保存失败',
        duration: 3000,
      })
    }
  }, [sessions, addToast])

  const handleExportSession = useCallback(async (sessionId: string) => {
    setContextMenu(null)
    try {
      const { messages } = await sessionsApi.getMessages(sessionId)
      const session = sessions.find(s => s.id === sessionId)
      const title = session?.title || '对话'
      const defaultName = `${title}_${new Date().toISOString().slice(0, 10)}.html`
      let htmlParts: string[] = []
      htmlParts.push(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>`)
      htmlParts.push(`<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;background:#1a1a2e;color:#e0e0e0;line-height:1.6}`)
      htmlParts.push(`.msg{margin:12px 0;padding:12px 16px;border-radius:12px;word-wrap:break-word}`)
      htmlParts.push(`.user{background:#2d2d5e;border:1px solid #3d3d7e}`)
      htmlParts.push(`.assistant{background:#1e2a3a;border:1px solid #2e3a4a}`)
      htmlParts.push(`.tool{background:#1a2a1a;border:1px solid #2a3a2a;font-size:0.9em}`)
      htmlParts.push(`.system{background:#2a2a1a;border:1px solid #3a3a2a;font-style:italic;font-size:0.9em}`)
      htmlParts.push(`.label{font-weight:bold;font-size:0.85em;color:#8888cc;margin-bottom:4px}`)
      htmlParts.push(`.error{color:#ff6b6b}`)
      htmlParts.push(`img{max-width:100%;border-radius:8px;margin:4px 0}`)
      htmlParts.push(`pre{background:#0d0d1a;padding:8px 12px;border-radius:8px;overflow-x:auto;font-size:0.9em}`)
      htmlParts.push(`code{font-family:"Fira Code",Consolas,monospace}`)
      htmlParts.push(`h1{color:#c0c0ff;border-bottom:1px solid #3d3d7e;padding-bottom:8px}`)
      htmlParts.push(`.meta{color:#888;font-size:0.8em;margin-top:4px}</style></head><body>`)
      htmlParts.push(`<h1>${escapeHtml(title)}</h1>`)
      htmlParts.push(`<p class="meta">导出时间: ${new Date().toLocaleString('zh-CN')}</p>`)

      for (const msg of messages) {
        const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN') : ''
        const metaStr = ts ? `<div class="meta">${ts}</div>` : ''
        if (msg.type === 'user') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
          const imagesHtml = extractImagesFromContent(msg.content)
          htmlParts.push(`<div class="msg user"><div class="label">👤 用户</div><div>${escapeHtml(content)}</div>${imagesHtml}${metaStr}</div>`)
        } else if (msg.type === 'assistant') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
          htmlParts.push(`<div class="msg assistant"><div class="label">🤖 助手</div><div>${formatAssistantContent(content)}</div>${metaStr}</div>`)
        } else if (msg.type === 'tool_use') {
          const input = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
          htmlParts.push(`<div class="msg tool"><div class="label">🔧 工具调用</div><pre><code>${escapeHtml(input)}</code></pre>${metaStr}</div>`)
        } else if (msg.type === 'tool_result') {
          const result = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
          const imagesHtml = extractImagesFromContent(msg.content)
          htmlParts.push(`<div class="msg tool"><div class="label">📋 工具结果</div><pre><code>${escapeHtml(result)}</code></pre>${imagesHtml}${metaStr}</div>`)
        } else if (msg.type === 'system') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          htmlParts.push(`<div class="msg system"><div class="label">⚙️ 系统</div><div>${escapeHtml(content)}</div>${metaStr}</div>`)
        }
      }
      htmlParts.push(`</body></html>`)
      const htmlStr = htmlParts.join('')

      if (isTauri) {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const filePath = await save({ defaultPath: defaultName, filters: [{ name: 'HTML', extensions: ['html'] }] })
        if (!filePath) return
        const { writeFile } = await import('@tauri-apps/plugin-fs')
        await writeFile(filePath, new TextEncoder().encode(htmlStr))
      } else {
        const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultName
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch {}
  }, [sessions])

  const handleOpenSaveDir = useCallback(async () => {
    setContextMenu(null)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const { documentDir } = await import('@tauri-apps/api/path')
      const saveDir = await documentDir()
      if (saveDir) {
        await invoke('show_in_folder', { path: saveDir })
      }
    } catch {}
  }, [])

  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return
    startDraggingRef.current?.()
  }, [])

  const t = useTranslation()

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className="sidebar-panel relative h-full flex flex-col bg-[var(--color-surface-sidebar)] border-r border-[var(--color-border)] select-none"
      data-state={sidebarOpen ? 'open' : 'closed'}
      aria-label="Sidebar"
    >
      <div className={`px-3 pb-2 ${isTauri && !isWindows ? 'pt-[44px]' : 'pt-3'}`}>
        <div className={`flex ${sidebarOpen ? 'items-center justify-between gap-3' : 'flex-col items-center gap-2'}`}>
          <div className={`flex min-w-0 items-center ${sidebarOpen ? 'gap-2.5' : 'justify-center'}`}>
            <img src="/app-icon.png" alt="" className="h-8 w-8 flex-shrink-0" />
            <span
              className={`sidebar-copy ${sidebarOpen ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]`}
              style={{ fontFamily: 'var(--font-headline)' }}
            >
            Claude-GZ
            </span>
          </div>
          <div className={`flex items-center ${sidebarOpen ? 'gap-1.5' : 'flex-col gap-2'}`}>
            <a
              href="https://github.com/xianshiyue0432/Claude-GZ"
              target="_blank"
              rel="noopener noreferrer"
              className={`sidebar-copy ${sidebarOpen ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} inline-flex items-center justify-center rounded-md p-1 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]`}
              title="GitHub"
              tabIndex={sidebarOpen ? undefined : -1}
              aria-hidden={!sidebarOpen}
            >
              <GitHubIcon />
            </a>
            <button
              type="button"
              onClick={toggleSidebar}
              data-testid={sidebarOpen ? 'sidebar-collapse-button' : 'sidebar-expand-button'}
              className={`sidebar-toggle-button ${sidebarOpen ? 'sidebar-toggle-button--open h-8 w-8' : 'sidebar-toggle-button--collapsed h-8 w-8'} flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-sidebar)]`}
              aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
              title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
            >
              <SidebarToggleIcon collapsed={!sidebarOpen} />
            </button>
          </div>
        </div>
      </div>

      <div className={`px-3 pb-3 flex flex-col ${sidebarOpen ? 'gap-0.5' : 'items-center gap-2'}`}>
        <NavItem
          active={false}
          collapsed={!sidebarOpen}
          label={t('sidebar.newSession')}
          onClick={async () => {
            try {
              const currentTabId = useTabStore.getState().activeTabId
              const currentSession = currentTabId
                ? useSessionStore.getState().sessions.find((s) => s.id === currentTabId)
                : null
              const workDir = currentSession?.workDir || undefined
              const sessionId = await useSessionStore.getState().createSession(workDir)
              useTabStore.getState().openTab(sessionId, t('sidebar.newSession'))
              useChatStore.getState().connectToSession(sessionId)
            } catch (error) {
              addToast({
                type: 'error',
                message: error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
              })
            }
          }}
          icon={<PlusIcon />}
        >
          {t('sidebar.newSession')}
        </NavItem>
        <NavItem
          active={activeTabId === SCHEDULED_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.scheduled')}
          onClick={() => useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')}
          icon={<ClockIcon />}
        >
          {t('sidebar.scheduled')}
        </NavItem>
        <NavItem
          active={activeTabId === TERMINAL_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.terminal')}
          onClick={() => useTabStore.getState().openTab(TERMINAL_TAB_ID, t('sidebar.terminal'), 'terminal')}
          icon={<TerminalIcon />}
        >
          {t('sidebar.terminal')}
        </NavItem>
      </div>

      {sidebarOpen ? (
        <>
          <div
            data-testid="sidebar-project-filter-section"
            className="sidebar-section sidebar-section--visible relative z-20 flex-none px-3 pb-2"
            style={{ overflow: 'visible' }}
          >
            <div className="flex h-9 items-center rounded-[14px] border border-[var(--color-sidebar-search-border)] bg-[var(--color-sidebar-search-bg)] pl-1.5 pr-3 transition-colors focus-within:border-[var(--color-border-focus)]">
              <ProjectFilter variant="embedded" />
              <span className="mx-2 h-4 w-px bg-[var(--color-border)]/80" aria-hidden="true" />
              <span className="pointer-events-none flex shrink-0 items-center text-[var(--color-text-tertiary)]">
                <SearchIcon />
              </span>
              <input
                id="sidebar-search"
                type="text"
                placeholder={t('sidebar.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent pl-2 pr-0 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
              />
            </div>
          </div>

          <div
            data-testid="sidebar-session-list-section"
            className="sidebar-section sidebar-section--visible flex flex-1 min-h-0 flex-col"
          >
            <div
              className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto px-3"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--color-outline) transparent',
              }}
            >
              {error && (
                <div className="mx-1 mt-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-3 py-2">
                  <div className="text-xs font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
                  <div className="mt-1 text-[11px] text-[var(--color-text-secondary)] break-words">{error}</div>
                  <button
                    onClick={() => fetchSessions()}
                    className="mt-2 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
              {filteredSessions.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )}
              {sortedGroupKeys.map((group) => {
                const items = timeGroups.get(group)
                if (!items || items.length === 0) return null
                // 格式化分组标题
                let groupLabel = ''
                if (group === 'today') {
                  groupLabel = '今天'
                } else if (group === 'yesterday') {
                  groupLabel = '昨天'
                } else {
                  // 日期格式：YYYYMMDD
                  groupLabel = group
                }
                
                // 分离有效对话和无效对话
                const validSessions: typeof items = []
                const invalidSessions: typeof items = []
                
                items.forEach(session => {
                  const messages = sessionMessages.get(session.id)
                  if (!messages) {
                    validSessions.push(session) // 默认显示
                    return
                  }
                  const userMessages = messages.filter(m => m.type === 'user')
                  const hasValid = userMessages.some(m => hasValidContent(m.content))
                  if (hasValid) {
                    validSessions.push(session)
                  } else {
                    invalidSessions.push(session)
                  }
                })
                
                const isExpanded = expandedInvalidSessions.has(group)
                
                return (
                  <div key={group} className="mb-1">
                    <div className="px-2 pb-1 pt-4 text-[11px] font-semibold tracking-wide text-[var(--color-text-tertiary)]">
                      {groupLabel}
                    </div>
                    
                    {/* 有效对话 - 单独显示 */}
                    {validSessions.map((session) => {
                      const messages = sessionMessages.get(session.id)
                      // 优先显示 session.title（用户重命名或服务器自动生成的标题）
                      // 如果没有标题，则从消息内容生成预览
                      const displayTitle = session.title && session.title.length > 0 && session.title !== 'New Session'
                        ? session.title
                        : ''
                      const contentPreview = displayTitle || (messages 
                        ? getFirstMessagePreview(messages)
                        : '未命名')
                      // 格式化时间 HH:MM
                      const sessionDate = new Date(session.modifiedAt)
                      const timeStr = `${String(sessionDate.getHours()).padStart(2, '0')}:${String(sessionDate.getMinutes()).padStart(2, '0')}`
                      return (
                        <div key={session.id} className="relative">
                          {renamingId === session.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={handleFinishRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleFinishRename()
                                if (e.key === 'Escape') {
                                  setRenamingId(null)
                                  setRenameValue('')
                                }
                              }}
                              className="ml-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border-focus)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => {
                                useTabStore.getState().openTab(session.id, session.title)
                                useChatStore.getState().connectToSession(session.id)
                              }}
                              onContextMenu={(e) => handleContextMenu(e, session.id)}
                              className={`
                                group w-full rounded-[12px] px-3 py-2 text-left text-sm transition-colors duration-200
                                ${session.id === activeTabId
                                  ? 'bg-[var(--color-sidebar-item-active)] text-[var(--color-text-primary)]'
                                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)]'
                                }
                              `}
                            >
                              <span className="flex items-center gap-2">
                                <span className="flex-shrink-0 text-[11px] text-[var(--color-text-tertiary)] font-mono">
                                  【{timeStr}】
                                </span>
                                <span className="flex-1 truncate font-medium tracking-[-0.01em]">
                                  {contentPreview}
                                </span>
                                {!session.workDirExists && (
                                  <span
                                    className="flex-shrink-0 text-[10px] text-[var(--color-warning)]"
                                    title={session.workDir ?? ''}
                                  >
                                    {t('sidebar.missingDir')}
                                  </span>
                                )}
                              </span>
                            </button>
                          )}
                        </div>
                      )
                    })}
                    
                    {/* 无效对话 - 折叠成一行 */}
                    {invalidSessions.length > 0 && (
                      <div className="mt-1">
                        <button
                          onClick={() => {
                            setExpandedInvalidSessions(prev => {
                              const next = new Set(prev)
                              if (next.has(group)) {
                                next.delete(group)
                              } else {
                                next.add(group)
                              }
                              return next
                            })
                          }}
                          className="w-full rounded-[12px] px-3 py-1.5 text-left text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-sidebar-item-hover)] transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex-shrink-0">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            <span className="flex-1 truncate">
                              {invalidSessions.length} 个无效对话 {isExpanded ? '(点击折叠)' : '(点击展开)'}
                            </span>
                          </span>
                        </button>
                        
                        {isExpanded && (
                          <div className="mt-1 pl-2 border-l-2 border-[var(--color-border)]">
                            {invalidSessions.map((session) => {
                              const messages = sessionMessages.get(session.id)
                              const contentPreview = messages 
                                ? getFirstMessagePreview(messages)
                                : '[无内容]'
                              const sessionDate = new Date(session.modifiedAt)
                              const timeStr = `${String(sessionDate.getHours()).padStart(2, '0')}:${String(sessionDate.getMinutes()).padStart(2, '0')}`
                              return (
                                <div key={session.id} className="relative">
                                  <button
                                    onClick={() => {
                                      useTabStore.getState().openTab(session.id, session.title)
                                      useChatStore.getState().connectToSession(session.id)
                                    }}
                                    onContextMenu={(e) => handleContextMenu(e, session.id)}
                                    className={`
                                      group w-full rounded-[8px] px-2 py-1.5 text-left text-xs transition-colors duration-200
                                      ${session.id === activeTabId
                                        ? 'bg-[var(--color-sidebar-item-active)] text-[var(--color-text-primary)]'
                                        : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-sidebar-item-hover)]'
                                      }
                                    `}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="flex-shrink-0 text-[10px] font-mono opacity-60">
                                        {timeStr}
                                      </span>
                                      <span className="flex-1 truncate opacity-80">
                                        {contentPreview}
                                      </span>
                                    </span>
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1" aria-hidden="true" />
      )}

      <div className={`border-t border-[var(--color-border)] p-3 ${sidebarOpen ? '' : 'flex justify-center'}`}>
        <NavItem
          active={activeTabId === SETTINGS_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.settings')}
          onClick={() => useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')}
          icon={<span className="material-symbols-outlined text-[18px]">settings</span>}
        >
          {t('sidebar.settings')}
        </NavItem>
      </div>

      {contextMenu && sidebarOpen && (
        <div
          className="fixed z-50 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <button
            onClick={() => {
              const session = sessions.find((s) => s.id === contextMenu.id)
              handleStartRename(contextMenu.id, session?.title || '')
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {t('common.rename')}
          </button>
          <button
            onClick={() => handleSaveSession(contextMenu.id)}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            保存
          </button>
          <button
            onClick={() => handleExportSession(contextMenu.id)}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            导出
          </button>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            onClick={handleOpenSaveDir}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {t('sidebar.openSaveDir')}
          </button>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            onClick={() => handleDelete(contextMenu.id)}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-error)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {t('common.delete')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        onClose={() => setPendingDeleteSessionId(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteSessionId ? t('sidebar.confirmDelete') : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
    </aside>
  )
}

function groupByTime(sessions: SessionListItem[]): Map<TimeGroup | string, SessionListItem[]> {
  const groups = new Map<TimeGroup | string, SessionListItem[]>()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000

  for (const session of sessions) {
    const ts = new Date(session.modifiedAt).getTime()
    let group: TimeGroup | string
    if (ts >= startOfToday) {
      group = 'today'
    } else if (ts >= startOfYesterday) {
      group = 'yesterday'
    } else {
      // 按日期分组，格式：YYYYMMDD
      const date = new Date(ts)
      group = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    }

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(session)
  }

  return groups
}

function NavItem({
  active,
  collapsed,
  label,
  onClick,
  icon,
  children,
}: {
  active: boolean
  collapsed: boolean
  label: string
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`
        flex items-center transition-colors duration-200
        ${collapsed ? 'h-10 w-10 justify-center rounded-[var(--radius-md)] px-0 py-0' : 'w-full gap-2.5 rounded-[12px] px-3 py-2.5 text-sm'}
        ${active
          ? 'bg-[var(--color-sidebar-item-active)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]'
        }
      `}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className={`sidebar-copy ${collapsed ? 'sidebar-copy--hidden' : 'sidebar-copy--visible'}`}>
        {children}
      </span>
    </button>
  )
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function extractImagesFromContent(content: unknown): string {
  if (!content || typeof content === 'string') return ''
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'image' || (block.source && block.source.type === 'base64'))
      .map((block: any) => {
        const data = block.source?.data || block.data || ''
        const mimeType = block.source?.media_type || block.mimeType || 'image/png'
        if (data) return `<img src="data:${mimeType};base64,${data}" alt="图片" />`
        if (block.url) return `<img src="${escapeHtml(block.url)}" alt="图片" />`
        return ''
      })
      .join('')
  }
  if (typeof content === 'object') {
    const obj = content as any
    if (obj.type === 'image' || (obj.source && obj.source.type === 'base64')) {
      const data = obj.source?.data || obj.data || ''
      const mimeType = obj.source?.media_type || obj.mimeType || 'image/png'
      if (data) return `<img src="data:${mimeType};base64,${data}" alt="图片" />`
      if (obj.url) return `<img src="${escapeHtml(obj.url)}" alt="图片" />`
    }
  }
  return ''
}

function formatAssistantContent(content: string): string {
  let html = escapeHtml(content)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\n/g, '<br/>')
  return html
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="6 9 10 12 6 15" />
      <line x1="14" y1="15" x2="18" y2="15" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width={collapsed ? 16 : 14}
      height={collapsed ? 16 : 14}
      viewBox="0 0 14 14"
      fill="none"
      className={`sidebar-toggle-icon ${collapsed ? 'sidebar-toggle-icon--collapsed' : 'sidebar-toggle-icon--open'}`}
      aria-hidden="true"
    >
      <path
        d={collapsed ? 'M5 3 9 7l-4 4' : 'M9 3 5 7l4 4'}
        className="sidebar-toggle-chevron"
      />
    </svg>
  )
}

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { SETTINGS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useTeamStore } from '../../stores/teamStore'
import { sessionsApi } from '../../api/sessions'
import { skillsApi } from '../../api/skills'
import { mcpApi } from '../../api/mcp'
import { agentsApi } from '../../api/agents'
import { pluginsApi } from '../../api/plugins'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import type { AttachmentRef } from '../../types/chat'
import type { SkillMeta } from '../../types/skill'
import type { McpServerRecord } from '../../types/mcp'
import type { AgentDefinition } from '../../api/agents'
import type { PluginSummary } from '../../types/plugin'
import { AttachmentGallery } from './AttachmentGallery'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { FileSearchMenu, type FileSearchMenuHandle } from './FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from './LocalSlashCommandPanel'
import { DraggableTerminalWindow } from './DraggableTerminalWindow'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashTrigger,
  mergeSlashCommands,
  replaceSlashToken,
  resolveSlashUiAction,
} from './composerUtils'

type GitInfo = { branch: string | null; repoName: string | null; workDir: string; changedFiles: number }

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
}

type ChatInputProps = {
  variant?: 'default' | 'hero'
}

export function ChatInput({ variant = 'default' }: ChatInputProps) {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  // 5 popup states
  const [skillsPopupOpen, setSkillsPopupOpen] = useState(false)
  const [mcpPopupOpen, setMcpPopupOpen] = useState(false)
  const [agentPopupOpen, setAgentPopupOpen] = useState(false)
  const [pluginPopupOpen, setPluginPopupOpen] = useState(false)
  const [terminalPopupOpen, setTerminalPopupOpen] = useState(false)
  // data for popups
  const [availableSkills, setAvailableSkills] = useState<SkillMeta[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  // selected items (checked state)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set())
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set())
  // search filters for popups
  const [skillsSearch, setSkillsSearch] = useState('')
  const [mcpSearch, setMcpSearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [pluginSearch, setPluginSearch] = useState('')
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const skillsPopupRef = useRef<HTMLDivElement>(null)
  const mcpPopupRef = useRef<HTMLDivElement>(null)
  const agentPopupRef = useRef<HTMLDivElement>(null)
  const pluginPopupRef = useRef<HTMLDivElement>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const { sendMessage, stopGeneration } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const slashCommands = sessionState?.slashCommands ?? []
  const composerPrefill = sessionState?.composerPrefill ?? null
  const activeSession = useSessionStore((state) => activeTabId ? state.sessions.find((session) => session.id === activeTabId) ?? null : null)
  const sessionWorkDirs = useSessionStore((state) => state.sessionWorkDirs)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const isMemberSession = !!memberInfo
  const isActive = chatState !== 'idle'
  const isWorkspaceMissing = activeSession?.workDirExists === false
  const canSubmit = !isWorkspaceMissing && (input.trim().length > 0 || (!isMemberSession && attachments.length > 0))
  const isHeroComposer = variant === 'hero' && !isMemberSession
  const resolvedWorkDir = (activeTabId && sessionWorkDirs[activeTabId]) || activeSession?.workDir || gitInfo?.workDir || undefined

  useEffect(() => {
    textareaRef.current?.focus()
  }, [isActive])

  useEffect(() => {
    if (!composerPrefill) return

    setInput(composerPrefill.text)
    setAttachments(
      (composerPrefill.attachments ?? [])
        .filter((attachment) => attachment.type === 'image' || attachment.data)
        .map((attachment, index) => ({
          id: `rewind-prefill-${composerPrefill.nonce}-${index}`,
          name: attachment.name,
          type: attachment.type,
          mimeType: attachment.mimeType,
          previewUrl: attachment.type === 'image' ? attachment.data : undefined,
          data: attachment.data,
        })),
    )
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setSlashFilter('')
    setAtFilter('')
    setAtCursorPos(-1)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      el?.focus()
      const cursor = composerPrefill.text.length
      el?.setSelectionRange(cursor, cursor)
    })
  }, [composerPrefill])

  useEffect(() => {
    if (!activeTabId) {
      setGitInfo(null)
      return
    }
    if (isMemberSession) {
      setGitInfo(null)
      return
    }
    sessionsApi.getGitInfo(activeTabId).then(setGitInfo).catch(() => setGitInfo(null))
  }, [activeTabId, isMemberSession])

  useEffect(() => {
    if (!isMemberSession) return
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
  }, [isMemberSession, activeTabId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  useEffect(() => {
    if (!plusMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [plusMenuOpen])

  useEffect(() => {
    if (!slashMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setSlashMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!localSlashPanel) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setLocalSlashPanel(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [localSlashPanel])

  useEffect(() => {
    if (!fileSearchOpen) return
    const handleClick = (event: MouseEvent) => {
      const menu = document.getElementById('file-search-menu')
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setFileSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [fileSearchOpen])

  // Skills popup: close on outside click + fetch skills when opened
  useEffect(() => {
    if (!skillsPopupOpen) return
    const cwd = resolvedWorkDir || undefined
    skillsApi.list(cwd).then((res) => {
      const list = res.skills ?? []
      setAvailableSkills(list)
      setSelectedSkills(new Set(list.map((s) => s.name)))
    }).catch(() => {})
    const handleClick = (event: MouseEvent) => {
      if (skillsPopupRef.current && !skillsPopupRef.current.contains(event.target as Node)) {
        setSkillsPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [skillsPopupOpen, resolvedWorkDir])

  // MCP popup: close + fetch servers when opened
  useEffect(() => {
    if (!mcpPopupOpen) return
    const cwd = resolvedWorkDir || undefined
    mcpApi.list(cwd).then((res) => {
      setMcpServers(res.servers ?? [])
      setSelectedMcps(new Set((res.servers ?? []).filter((s) => s.enabled).map((s) => s.name)))
    }).catch(() => {})
    const handleClick = (event: MouseEvent) => {
      if (mcpPopupRef.current && !mcpPopupRef.current.contains(event.target as Node)) {
        setMcpPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mcpPopupOpen, resolvedWorkDir])

  // Agent popup: close + fetch agents when opened
  useEffect(() => {
    if (!agentPopupOpen) return
    const cwd = resolvedWorkDir || undefined
    agentsApi.list(cwd).then((res) => {
      setAgents(res.allAgents ?? [])
      setSelectedAgents(new Set((res.allAgents ?? []).filter((a) => a.isActive).map((a) => a.agentType)))
    }).catch(() => {})
    const handleClick = (event: MouseEvent) => {
      if (agentPopupRef.current && !agentPopupRef.current.contains(event.target as Node)) {
        setAgentPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [agentPopupOpen, resolvedWorkDir])

  // Plugin popup: close + fetch plugins when opened
  useEffect(() => {
    if (!pluginPopupOpen) return
    const cwd = resolvedWorkDir || undefined
    pluginsApi.list(cwd).then((res) => {
      const list = res.plugins ?? []
      setPlugins(list)
      setSelectedPlugins(new Set(list.filter((p: PluginSummary) => p.enabled).map((p: PluginSummary) => p.id)))
    }).catch(() => {})
    const handleClick = (event: MouseEvent) => {
      if (pluginPopupRef.current && !pluginPopupRef.current.contains(event.target as Node)) {
        setPluginPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pluginPopupOpen, resolvedWorkDir])

  const filteredCommands = useMemo(() => {
    const source = mergeSlashCommands(slashCommands, FALLBACK_SLASH_COMMANDS)
    if (!slashFilter) return source
    const lower = slashFilter.toLowerCase()
    return source.filter((command) => (
      command.name.toLowerCase().includes(lower) ||
      command.description.toLowerCase().includes(lower)
    ))
  }, [slashCommands, slashFilter])

  const exactSlashCommand = useMemo(() => {
    const normalized = slashFilter.trim().toLowerCase()
    if (!normalized) return null
    return filteredCommands.find((command) => command.name.toLowerCase() === normalized) ?? null
  }, [filteredCommands, slashFilter])

  // Filtered data for popups with search
  const filteredSkills = useMemo(() => {
    if (!skillsSearch) return availableSkills
    const lower = skillsSearch.toLowerCase()
    return availableSkills.filter((skill) =>
      skill.name.toLowerCase().includes(lower) ||
      (skill.displayName?.toLowerCase().includes(lower) ?? false) ||
      (skill.description?.toLowerCase().includes(lower) ?? false)
    )
  }, [availableSkills, skillsSearch])

  const filteredMcpServers = useMemo(() => {
    if (!mcpSearch) return mcpServers
    const lower = mcpSearch.toLowerCase()
    return mcpServers.filter((server) =>
      server.name.toLowerCase().includes(lower) ||
      (server.summary?.toLowerCase().includes(lower) ?? false)
    )
  }, [mcpServers, mcpSearch])

  const filteredAgents = useMemo(() => {
    if (!agentSearch) return agents
    const lower = agentSearch.toLowerCase()
    return agents.filter((agent) =>
      agent.agentType.toLowerCase().includes(lower) ||
      (agent.description?.toLowerCase().includes(lower) ?? false)
    )
  }, [agents, agentSearch])

  const filteredPlugins = useMemo(() => {
    if (!pluginSearch) return plugins
    const lower = pluginSearch.toLowerCase()
    return plugins.filter((plugin) =>
      plugin.name.toLowerCase().includes(lower) ||
      (plugin.version?.toLowerCase().includes(lower) ?? false)
    )
  }, [plugins, pluginSearch])

  // Select all / deselect all handlers
  const handleSelectAllSkills = () => {
    setSelectedSkills(new Set(availableSkills.map((s) => s.name)))
  }
  const handleDeselectAllSkills = () => {
    setSelectedSkills(new Set())
  }

  const handleSelectAllMcps = () => {
    setSelectedMcps(new Set(mcpServers.map((s) => s.name)))
  }
  const handleDeselectAllMcps = () => {
    setSelectedMcps(new Set())
  }

  const handleSelectAllAgents = () => {
    setSelectedAgents(new Set(agents.map((a) => a.agentType)))
  }
  const handleDeselectAllAgents = () => {
    setSelectedAgents(new Set())
  }

  const handleSelectAllPlugins = () => {
    setSelectedPlugins(new Set(plugins.map((p) => p.id)))
  }
  const handleDeselectAllPlugins = () => {
    setSelectedPlugins(new Set())
  }

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const activeItem = slashMenuOpen ? slashItemRefs.current[slashSelectedIndex] : null
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    const token = findSlashTrigger(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
      return
    }

    setFileSearchOpen(false)
    setSlashFilter(token.filter)
    setSlashMenuOpen(true)
  }, [])

  // Detect @ trigger (file search)
  const detectAtTrigger = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.slice(0, cursorPos)
    let pos = -1

    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
      const ch = textBeforeCursor[i]!
      if (ch === '@') {
        if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
          pos = i
          break
        }
        break
      }
      if (/\s/.test(ch)) {
        break
      }
    }

    if (pos < 0) {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
      return
    }

    // Extract filter text after @
    const filter = textBeforeCursor.slice(pos + 1)
    setAtFilter(filter)
    setAtCursorPos(cursorPos)
    setSlashMenuOpen(false)
    setFileSearchOpen(true)
  }, [])

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    if (isMemberSession) {
      setInput(value)
      return
    }
    const cursorPos = event.target.selectionStart ?? value.length
    setInput(value)
    detectSlashTrigger(value, cursorPos)
    detectAtTrigger(value, cursorPos)
  }

  const selectSlashCommand = useCallback((command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, command)
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }, [input])

  const handleSubmit = () => {
    const text = input.trim()
    if ((!text && (!attachments.length || isMemberSession)) || isWorkspaceMissing) return

    const slashUiAction = !isMemberSession && text.startsWith('/') ? resolveSlashUiAction(text.slice(1)) : null
    if (slashUiAction?.type === 'panel') {
      setLocalSlashPanel(slashUiAction.command as LocalSlashCommandName)
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'settings') {
      useUIStore.getState().setPendingSettingsTab(slashUiAction.tab)
      useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    const attachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      data: attachment.data,
      mimeType: attachment.mimeType,
    }))

    sendMessage(activeTabId!, text, attachmentPayload)

    const runtimeSelection = useSessionRuntimeStore.getState().selections[activeTabId!]
    if (runtimeSelection) {
      const updatedSelection = {
        ...runtimeSelection,
        enabledSkills: Array.from(selectedSkills),
        enabledMcpServers: Array.from(selectedMcps),
        enabledAgents: Array.from(selectedAgents),
        enabledPlugins: Array.from(selectedPlugins),
      }
      useSessionRuntimeStore.getState().setSelection(activeTabId!, updatedSelection)
      useChatStore.getState().setSessionRuntime(activeTabId!, updatedSelection)
    }

    setInput('')
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return

    // Route file search navigation keys to FileSearchMenu
    if (fileSearchOpen) {
      const key = event.key
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Tab' || key === 'Escape') {
        event.preventDefault()
        if (key === 'Escape') {
          setFileSearchOpen(false)
          setAtFilter('')
          setAtCursorPos(-1)
          return
        }
        fileSearchRef.current?.handleKeyDown(event.nativeEvent)
        return
      }
      // Other keys (typing) should go to the textarea - let it propagate
      return
    }

    if (slashMenuOpen && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === 'Enter') {
        if (exactSlashCommand && slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()) {
          event.preventDefault()
          handleSubmit()
          return
        }
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuOpen(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    if (isMemberSession) return
    const items = event.clipboardData?.items
    if (!items) return

    let hasImage = false
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || !item.type.startsWith('image/')) continue

      hasImage = true
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue

      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: `pasted-image-${Date.now()}.png`,
            type: 'image',
            mimeType: file.type || 'image/png',
            previewUrl: reader.result as string,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    }

    if (!hasImage) return
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isMemberSession) return
    const files = event.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const isImage = file.type.startsWith('image/')
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            type: isImage ? 'image' : 'file',
            mimeType: file.type || undefined,
            previewUrl: isImage ? (reader.result as string) : undefined,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (isMemberSession) return
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const fakeEvent = { target: { files } } as React.ChangeEvent<HTMLInputElement>
      handleFileSelect(fakeEvent)
    }
  }

  const insertSlashCommand = () => {
    if (isMemberSession) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, '', { trailingSpace: false })
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const composerPlaceholder =
    isHeroComposer
      ? t('empty.placeholder')
      : isWorkspaceMissing
        ? t('chat.placeholderMissing')
        : isMemberSession
          ? t('teams.memberPlaceholder')
          : t('chat.placeholder')

  const addFilesLabel = isHeroComposer ? t('empty.addFiles') : t('chat.addFiles')

  return (
    <div className={isHeroComposer ? 'bg-[var(--color-surface)] px-8 pb-4' : 'bg-[var(--color-surface)] px-4 py-4'}>
      <div className={isHeroComposer ? 'mx-auto flex w-full max-w-3xl flex-col gap-2' : 'mx-auto max-w-[860px]'}>
        <div
          className={isHeroComposer
            ? 'glass-panel relative flex flex-col gap-3 rounded-xl p-4 transition-colors'
            : 'glass-panel relative rounded-xl p-4 transition-colors'}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {!isMemberSession && fileSearchOpen && (
            <FileSearchMenu
              ref={fileSearchRef}
              cwd={resolvedWorkDir || ''}
              filter={atFilter}
              onSelect={(_path, name) => {
                if (atCursorPos >= 0) {
                  // Insert name at cursor position, replacing filter text
                  const newValue = `${input.slice(0, atCursorPos)}${name}${input.slice(atCursorPos)}`
                  const newCursorPos = atCursorPos + name.length
                  setInput(newValue)
                  setFileSearchOpen(false)
                  setAtFilter('')
                  setAtCursorPos(-1)
                  void textareaRef.current?.focus()
                  requestAnimationFrame(() => {
                    textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
                  })
                }
              }}
            />
          )}

          {!isMemberSession && localSlashPanel && (
            <div ref={slashMenuRef}>
              <LocalSlashCommandPanel
                command={localSlashPanel}
                cwd={resolvedWorkDir}
                onClose={() => setLocalSlashPanel(null)}
              />
            </div>
          )}

          {!isMemberSession && slashMenuOpen && filteredCommands.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
            >
              <div className="max-h-[300px] overflow-y-auto py-1">
                {filteredCommands.map((command, index) => (
                  <button
                    key={command.name}
                    ref={(el) => { slashItemRefs.current[index] = el }}
                    onClick={() => selectSlashCommand(command.name)}
                    onMouseEnter={() => setSlashSelectedIndex(index)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      index === slashSelectedIndex
                        ? 'bg-[var(--color-surface-hover)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                      /{command.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-tertiary)]">
                      {command.description}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Up/Down</kbd>
                <span>{t('chat.navigate')}</span>
                <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
                <span>{t('chat.select')}</span>
                <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
                <span>{t('chat.dismiss')}</span>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            isHeroComposer ? (
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            ) : (
              <div className="px-3 pt-3">
                <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
              </div>
            )
          )}

          {isHeroComposer ? (
            <div className="flex items-start gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={() => { composingRef.current = false }}
                onPaste={handlePaste}
                placeholder={composerPlaceholder}
                disabled={isWorkspaceMissing}
                rows={2}
                className="flex-1 resize-none border-none bg-transparent py-2 leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
              />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onPaste={handlePaste}
              placeholder={composerPlaceholder}
              disabled={isWorkspaceMissing}
              rows={1}
              className="w-full resize-none bg-transparent py-2 pb-12 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
            />
          )}

          <div className={isHeroComposer
            ? 'flex items-center justify-between border-t border-[var(--color-border-separator)] pt-3'
            : 'absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-[var(--color-border-separator)] px-3 py-3'}>
            {/* Left side: 5 action buttons */}
            <div className="flex items-center gap-1">
              {!isMemberSession && (
                <>
                  {/* Original: + file picker */}
                  <div ref={plusMenuRef} className="relative">
                    <button
                      onClick={() => setPlusMenuOpen((value) => !value)}
                      aria-label={addFilesLabel}
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>

                    {plusMenuOpen && (
                      <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
                        <button
                          onClick={() => {
                            fileInputRef.current?.click()
                            setPlusMenuOpen(false)
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">attach_file</span>
                          <span className="text-sm text-[var(--color-text-primary)]">{addFilesLabel}</span>
                        </button>
                        <button
                          onClick={insertSlashCommand}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="w-[24px] text-center text-[18px] font-bold text-[var(--color-text-secondary)]">/</span>
                          <span className="text-sm text-[var(--color-text-primary)]">{t('chat.slashCommands')}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <PermissionModeSelector />

                  {/* 1. Skills: button + popup in same relative container */}
                  <div ref={skillsPopupRef} className="relative">
                    <button
                      onClick={() => { setSkillsPopupOpen((v) => !v); setMcpPopupOpen(false); setAgentPopupOpen(false); setPluginPopupOpen(false); setTerminalPopupOpen(false) }}
                      title={t('chat.skills')}
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                    </button>
                    {skillsPopupOpen && (
                      <div className="absolute bottom-full right-0 z-50 mb-2 w-[320px] max-h-[400px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                        {/* Header with title and select all/none */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                          <p className="text-xs font-medium text-[var(--color-text-primary)]">{t('chat.skillSelectHint')}</p>
                          <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedSkills.size}/{availableSkills.length}</span>
                        </div>
                        {/* Search and action buttons */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
                          <div className="flex-1 relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">search</span>
                            <input
                              type="text"
                              value={skillsSearch}
                              onChange={(e) => setSkillsSearch(e.target.value)}
                              placeholder={t('common.search')}
                              className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-focus)]"
                            />
                          </div>
                          <button
                            onClick={handleSelectAllSkills}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.selectAll')}
                          </button>
                          <button
                            onClick={handleDeselectAllSkills}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.deselectAll')}
                          </button>
                        </div>
                        {/* Skills list */}
                        <div className="overflow-y-auto py-1 min-h-0 flex-1">
                          {filteredSkills.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noSkills')}</div>
                          )}
                          {filteredSkills.map((skill) => (
                            <label key={skill.name} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                                checked={selectedSkills.has(skill.name)}
                                onChange={() => {
                                  setSelectedSkills((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(skill.name)) { next.delete(skill.name) } else { next.add(skill.name) }
                                    return next
                                  })
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--color-text-primary)] truncate">{skill.displayName || skill.name}</div>
                                {skill.description && (
                                  <div className="text-[11px] text-[var(--color-text-tertiary)] truncate">{skill.description}</div>
                                )}
                              </div>
                              <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0 uppercase">{skill.source}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. MCP: button + popup in same relative container */}
                  <div ref={mcpPopupRef} className="relative">
                    <button
                      onClick={() => { setMcpPopupOpen((v) => !v); setSkillsPopupOpen(false); setAgentPopupOpen(false); setPluginPopupOpen(false); setTerminalPopupOpen(false) }}
                      title="MCP"
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">hub</span>
                    </button>
                    {mcpPopupOpen && (
                      <div className="absolute bottom-full right-0 z-50 mb-2 w-[320px] max-h-[400px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                        {/* Header with title and count */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                          <p className="text-xs font-medium text-[var(--color-text-primary)]">{t('chat.mcpSelectHint')}</p>
                          <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedMcps.size}/{mcpServers.length}</span>
                        </div>
                        {/* Search and action buttons */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
                          <div className="flex-1 relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">search</span>
                            <input
                              type="text"
                              value={mcpSearch}
                              onChange={(e) => setMcpSearch(e.target.value)}
                              placeholder={t('common.search')}
                              className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-focus)]"
                            />
                          </div>
                          <button
                            onClick={handleSelectAllMcps}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.selectAll')}
                          </button>
                          <button
                            onClick={handleDeselectAllMcps}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.deselectAll')}
                          </button>
                        </div>
                        {/* MCP list */}
                        <div className="overflow-y-auto py-1 min-h-0 flex-1">
                          {filteredMcpServers.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noMcp')}</div>
                          )}
                          {filteredMcpServers.map((server) => (
                            <label key={`${server.scope}:${server.name}`} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                                checked={selectedMcps.has(server.name)}
                                onChange={() => {
                                  setSelectedMcps((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(server.name)) { next.delete(server.name) } else { next.add(server.name) }
                                    return next
                                  })
                                  if (server.canToggle) {
                                    mcpApi.toggle(server.name, resolvedWorkDir || undefined).catch(() => {})
                                  }
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--color-text-primary)] truncate">{server.name}</div>
                                <div className="text-[11px] text-[var(--color-text-tertiary)] truncate">{server.summary}</div>
                              </div>
                              <span className={`shrink-0 h-2 w-2 rounded-full ${
                                server.status === 'connected' ? 'bg-green-500' :
                                server.status === 'failed' ? 'bg-red-500' :
                                server.status === 'checking' ? 'bg-yellow-500' : 'bg-gray-400'
                              }`} />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. Agent: button + popup in same relative container */}
                  <div ref={agentPopupRef} className="relative">
                    <button
                      onClick={() => { setAgentPopupOpen((v) => !v); setSkillsPopupOpen(false); setMcpPopupOpen(false); setPluginPopupOpen(false); setTerminalPopupOpen(false) }}
                      title="Agent"
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                    </button>
                    {agentPopupOpen && (
                      <div className="absolute bottom-full right-0 z-50 mb-2 w-[320px] max-h-[400px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                        {/* Header with title and count */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                          <p className="text-xs font-medium text-[var(--color-text-primary)]">{t('chat.agentSelectHint')}</p>
                          <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedAgents.size}/{agents.length}</span>
                        </div>
                        {/* Search and action buttons */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
                          <div className="flex-1 relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">search</span>
                            <input
                              type="text"
                              value={agentSearch}
                              onChange={(e) => setAgentSearch(e.target.value)}
                              placeholder={t('common.search')}
                              className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-focus)]"
                            />
                          </div>
                          <button
                            onClick={handleSelectAllAgents}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.selectAll')}
                          </button>
                          <button
                            onClick={handleDeselectAllAgents}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.deselectAll')}
                          </button>
                        </div>
                        {/* Agent list */}
                        <div className="overflow-y-auto py-1 min-h-0 flex-1">
                          {filteredAgents.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noAgents')}</div>
                          )}
                          {filteredAgents.map((agent) => (
                            <label key={agent.agentType} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                                checked={selectedAgents.has(agent.agentType)}
                                onChange={() => {
                                  setSelectedAgents((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(agent.agentType)) { next.delete(agent.agentType) } else { next.add(agent.agentType) }
                                    return next
                                  })
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--color-text-primary)] truncate">{agent.agentType}</div>
                                {agent.description && (
                                  <div className="text-[11px] text-[var(--color-text-tertiary)] truncate">{agent.description}</div>
                                )}
                              </div>
                              <span className={`shrink-0 text-[10px] ${agent.isActive ? 'text-green-500' : 'text-gray-400'}`}>
                                {agent.isActive ? 'ON' : 'OFF'}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. Plugin: button + popup in same relative container */}
                  <div ref={pluginPopupRef} className="relative">
                    <button
                      onClick={() => { setPluginPopupOpen((v) => !v); setSkillsPopupOpen(false); setMcpPopupOpen(false); setAgentPopupOpen(false); setTerminalPopupOpen(false) }}
                      title={t('chat.plugins')}
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">extension</span>
                    </button>
                    {pluginPopupOpen && (
                      <div className="absolute bottom-full right-0 z-50 mb-2 w-[340px] max-h-[400px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                        {/* Header with title and count */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                          <p className="text-xs font-medium text-[var(--color-text-primary)]">{t('chat.pluginSelectHint')}</p>
                          <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedPlugins.size}/{plugins.length}</span>
                        </div>
                        {/* Search and action buttons */}
                        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
                          <div className="flex-1 relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">search</span>
                            <input
                              type="text"
                              value={pluginSearch}
                              onChange={(e) => setPluginSearch(e.target.value)}
                              placeholder={t('common.search')}
                              className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-focus)]"
                            />
                          </div>
                          <button
                            onClick={handleSelectAllPlugins}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.selectAll')}
                          </button>
                          <button
                            onClick={handleDeselectAllPlugins}
                            className="px-2 h-7 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                          >
                            {t('common.deselectAll')}
                          </button>
                        </div>
                        {/* Plugin list */}
                        <div className="overflow-y-auto py-1 min-h-0 flex-1">
                          {filteredPlugins.length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noPlugins')}</div>
                          )}
                          {filteredPlugins.map((plugin) => (
                            <label key={plugin.id} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                                checked={selectedPlugins.has(plugin.id)}
                                onChange={() => {
                                  const shouldEnable = !selectedPlugins.has(plugin.id)
                                  setSelectedPlugins((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(plugin.id)) { next.delete(plugin.id) } else { next.add(plugin.id) }
                                    return next
                                  })
                                  if (shouldEnable) {
                                    pluginsApi.enable({ id: plugin.id, scope: plugin.scope }).catch(() => {})
                                  } else {
                                    pluginsApi.disable({ id: plugin.id, scope: plugin.scope }).catch(() => {})
                                  }
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--color-text-primary)] truncate">{plugin.name}</div>
                                {plugin.version && (
                                  <div className="text-[11px] text-[var(--color-text-tertiary)]">v{plugin.version}</div>
                                )}
                              </div>
                              <span className={`shrink-0 h-2 w-2 rounded-full ${plugin.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 5. Terminal: button + floating draggable/resizable window */}
                  <DraggableTerminalWindow
                    open={terminalPopupOpen}
                    onToggle={() => {
                      setTerminalPopupOpen((v) => !v)
                      setSkillsPopupOpen(false)
                      setMcpPopupOpen(false)
                      setAgentPopupOpen(false)
                      setPluginPopupOpen(false)
                    }}
                    onClose={() => setTerminalPopupOpen(false)}
                    cwd={resolvedWorkDir || undefined}
                    onCwdChange={async (newWorkDir) => {
                      if (!activeTabId) return
                      const oldId = activeTabId
                      const { deleteSession, createSession } = useSessionStore.getState()
                      const { replaceTabSession } = useTabStore.getState()
                      const { disconnectSession, connectToSession } = useChatStore.getState()
                      const newId = await createSession(newWorkDir)
                      useSessionRuntimeStore.getState().moveSelection(oldId, newId)
                      disconnectSession(oldId)
                      replaceTabSession(oldId, newId)
                      connectToSession(newId)
                      deleteSession(oldId).catch(() => {})
                    }}
                  />
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!isMemberSession && activeTabId && (
                <ModelSelector runtimeKey={activeTabId} disabled={isActive} />
              )}
              <button
                onClick={!isMemberSession && isActive ? () => stopGeneration(activeTabId!) : handleSubmit}
                disabled={!isMemberSession && isActive ? false : !canSubmit}
                title={!isMemberSession && isActive ? t('chat.stopTitle') : undefined}
                className={`flex w-[112px] items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:brightness-105 disabled:opacity-30 ${
                  !isMemberSession && isActive
                    ? 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                    : 'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)]'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {!isMemberSession && isActive ? 'stop' : 'arrow_forward'}
                </span>
                {!isMemberSession && isActive ? t('common.stop') : isMemberSession ? t('common.send') : t('common.run')}
              </button>
            </div>
          </div>
        </div>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

        {!isMemberSession && (
          <div className="mt-3 px-1">
            <DirectoryPicker
              value={resolvedWorkDir || ''}
              onChange={async (newWorkDir) => {
                if (!activeTabId) return
                const oldId = activeTabId
                const { deleteSession, createSession } = useSessionStore.getState()
                const { replaceTabSession } = useTabStore.getState()
                const { disconnectSession, connectToSession } = useChatStore.getState()
                const newId = await createSession(newWorkDir)
                useSessionRuntimeStore.getState().moveSelection(oldId, newId)
                disconnectSession(oldId)
                replaceTabSession(oldId, newId)
                connectToSession(newId)
                deleteSession(oldId).catch(() => {})
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

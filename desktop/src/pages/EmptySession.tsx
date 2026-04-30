import { useEffect, useMemo, useRef, useState } from 'react'
import { skillsApi } from '../api/skills'
import { mcpApi } from '../api/mcp'
import { agentsApi } from '../api/agents'
import { pluginsApi } from '../api/plugins'
import { useTranslation } from '../i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useProviderStore } from '../stores/providerStore'
import { useSessionRuntimeStore, DRAFT_RUNTIME_SELECTION_KEY } from '../stores/sessionRuntimeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { SETTINGS_TAB_ID, useTabStore } from '../stores/tabStore'
import { OFFICIAL_DEFAULT_MODEL_ID } from '../constants/modelCatalog'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { PermissionModeSelector } from '../components/controls/PermissionModeSelector'
import { ModelSelector } from '../components/controls/ModelSelector'
import { AttachmentGallery } from '../components/chat/AttachmentGallery'
import { FileSearchMenu, type FileSearchMenuHandle } from '../components/chat/FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from '../components/chat/LocalSlashCommandPanel'
import { DraggableTerminalWindow } from '../components/chat/DraggableTerminalWindow'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashToken,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceSlashCommand,
  resolveSlashUiAction,
} from '../components/chat/composerUtils'
import type { AttachmentRef } from '../types/chat'
import type { SkillMeta } from '../types/skill'
import type { McpServerRecord } from '../types/mcp'
import type { AgentDefinition } from '../api/agents'
import type { PluginSummary } from '../types/plugin'
import type { SlashCommandOption } from '../components/chat/composerUtils'

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
}

export function EmptySession() {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workDir, setWorkDir] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [slashCommands, setSlashCommands] = useState<SlashCommandOption[]>([])
  const [skillsPopupOpen, setSkillsPopupOpen] = useState(false)
  const [mcpPopupOpen, setMcpPopupOpen] = useState(false)
  const [agentPopupOpen, setAgentPopupOpen] = useState(false)
  const [pluginPopupOpen, setPluginPopupOpen] = useState(false)
  const [terminalPopupOpen, setTerminalPopupOpen] = useState(false)
  const [availableSkills, setAvailableSkills] = useState<SkillMeta[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set())
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set())
  const skillsPopupRef = useRef<HTMLDivElement>(null)
  const mcpPopupRef = useRef<HTMLDivElement>(null)
  const agentPopupRef = useRef<HTMLDivElement>(null)
  const pluginPopupRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const createSession = useSessionStore((state) => state.createSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const setSessionRuntime = useChatStore((state) => state.setSessionRuntime)
  const connectToSession = useChatStore((state) => state.connectToSession)
  const setActiveView = useUIStore((state) => state.setActiveView)
  const addToast = useUIStore((state) => state.addToast)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

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

  useEffect(() => {
    if (!skillsPopupOpen) return
    skillsApi.list(workDir || undefined).then((res) => {
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
  }, [skillsPopupOpen, workDir])

  useEffect(() => {
    if (!mcpPopupOpen) return
    mcpApi.list(workDir || undefined).then((res) => {
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
  }, [mcpPopupOpen, workDir])

  useEffect(() => {
    if (!agentPopupOpen) return
    agentsApi.list(workDir || undefined).then((res) => {
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
  }, [agentPopupOpen, workDir])

  useEffect(() => {
    if (!pluginPopupOpen) return
    pluginsApi.list(workDir || undefined).then((res) => {
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
  }, [pluginPopupOpen, workDir])

  useEffect(() => {
    let cancelled = false

    skillsApi.list(workDir || undefined)
      .then(({ skills }) => {
        if (cancelled) return
        setSlashCommands(
          skills
            .filter((skill) => skill.userInvocable)
            .map((skill) => ({
              name: skill.name,
              description: skill.description,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setSlashCommands([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [workDir])

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

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const activeItem = slashMenuOpen ? slashItemRefs.current[slashSelectedIndex] : null
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const handleSubmit = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || isSubmitting) return

    const slashUiAction = text.startsWith('/') ? resolveSlashUiAction(text.slice(1)) : null
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

    setIsSubmitting(true)
    try {
      const settings = useSettingsStore.getState()
      let providerState = useProviderStore.getState()
      if (
        settings.activeProviderName &&
        providerState.providers.length === 0 &&
        !providerState.isLoading
      ) {
        await providerState.fetchProviders()
        providerState = useProviderStore.getState()
      }
      const inferredProviderId = providerState.activeId ?? (
        settings.activeProviderName
          ? providerState.providers.find((provider) => provider.name === settings.activeProviderName)?.id ?? null
          : null
      )
      const draftSelection =
        useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]
        ?? {
          providerId: inferredProviderId,
          modelId: settings.currentModel?.id ?? OFFICIAL_DEFAULT_MODEL_ID,
        }
      const sessionId = await createSession(workDir || undefined)
      setActiveView('code')
      useTabStore.getState().openTab(sessionId, 'New Session')
      connectToSession(sessionId)
      const runtimeSelection = {
        ...draftSelection,
        enabledSkills: Array.from(selectedSkills),
        enabledMcpServers: Array.from(selectedMcps),
        enabledAgents: Array.from(selectedAgents),
        enabledPlugins: Array.from(selectedPlugins),
      }
      useSessionRuntimeStore.getState().setSelection(sessionId, runtimeSelection)
      useSessionRuntimeStore.getState().clearSelection(DRAFT_RUNTIME_SELECTION_KEY)
      setSessionRuntime(sessionId, runtimeSelection)
      const attachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        data: attachment.data,
        mimeType: attachment.mimeType,
      }))
      sendMessage(sessionId, text, attachmentPayload)
      setInput('')
      setAttachments([])
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (value: string, cursorPos: number) => {
    setInput(value)
    const token = findSlashToken(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
    } else {
      setSlashFilter(token.filter)
      setSlashMenuOpen(true)
    }

    // Detect @ trigger for file search
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
    } else {
      setAtFilter(textBeforeCursor.slice(pos + 1))
      setAtCursorPos(cursorPos)
      setSlashMenuOpen(false)
      setFileSearchOpen(true)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (event.nativeEvent.isComposing) return

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
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (
          event.key === 'Enter' &&
          exactSlashCommand &&
          slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()
        ) {
          event.preventDefault()
          void handleSubmit()
          return
        }
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
            mimeType: file.type || undefined,
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
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const fakeEvent = { target: { files } } as React.ChangeEvent<HTMLInputElement>
      handleFileSelect(fakeEvent)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const selectSlashCommand = (command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashCommand(input, cursorPos, command)
    if (!replacement) return
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const insertSlashCommand = () => {
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = insertSlashTrigger(input, cursorPos)
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex flex-1 flex-col items-center justify-center p-8 pb-32">
        <div className="flex max-w-md flex-col items-center text-center">
          <img src="/app-icon.png" alt="Claude-GZ" className="mb-6 h-24 w-24" />
          <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
            {t('empty.title')}
          </h1>
          <p className="mx-auto max-w-xs text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
            {t('empty.subtitle')}
          </p>
        </div>
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex justify-center px-8">
        <div className="flex w-full max-w-3xl flex-col gap-2">
          <div
            className="glass-panel relative flex flex-col gap-3 rounded-xl p-4"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {fileSearchOpen && (
              <FileSearchMenu
                ref={fileSearchRef}
                cwd={workDir || ''}
                filter={atFilter}
                onSelect={(_path, name) => {
                  if (atCursorPos >= 0) {
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

            {localSlashPanel && (
              <div ref={slashMenuRef}>
                <LocalSlashCommandPanel
                  command={localSlashPanel}
                  cwd={workDir || undefined}
                  onClose={() => setLocalSlashPanel(null)}
                />
              </div>
            )}

            {slashMenuOpen && filteredCommands.length > 0 && (
              <div
                ref={slashMenuRef}
                className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
              >
                <div className="max-h-[260px] overflow-y-auto py-1">
                  {filteredCommands.map((command, index) => (
                    <button
                      key={command.name}
                      ref={(el) => { slashItemRefs.current[index] = el }}
                      onClick={() => selectSlashCommand(command.name)}
                      onMouseEnter={() => setSlashSelectedIndex(index)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        index === slashSelectedIndex ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">/{command.name}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-tertiary)]">{command.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {attachments.length > 0 && (
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            )}

            <div className="flex items-start gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => handleInputChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="flex-1 resize-none border-none bg-transparent py-2 leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
                style={{ fontFamily: 'var(--font-body)' }}
                placeholder={t('empty.placeholder')}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between border-t border-[var(--color-border-separator)] pt-3">
              <div className="flex items-center gap-2">
                <div ref={plusMenuRef} className="relative">
                  <button
                    onClick={() => setPlusMenuOpen((prev) => !prev)}
                    aria-label="Open composer tools"
                    className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                  </button>

                  {plusMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-[240px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
                      <button
                        onClick={() => {
                          fileInputRef.current?.click()
                          setPlusMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">attach_file</span>
                        {t('empty.addFiles')}
                      </button>
                      <button
                        onClick={insertSlashCommand}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="w-5 text-center text-[18px] font-bold text-[var(--color-text-secondary)]">/</span>
                        {t('empty.slashCommands')}
                      </button>
                    </div>
                  )}
                </div>

                <PermissionModeSelector workDir={workDir} />

                {/* 1. Skills */}
                <div ref={skillsPopupRef} className="relative">
                  <button
                    onClick={() => { setSkillsPopupOpen((v) => !v); setMcpPopupOpen(false); setAgentPopupOpen(false); setPluginPopupOpen(false); setTerminalPopupOpen(false) }}
                    title={t('chat.skills')}
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                  </button>
                  {skillsPopupOpen && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 w-[280px] max-h-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                        <p className="text-xs text-[var(--color-text-tertiary)]">{t('chat.skillSelectHint')}</p>
                        <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedSkills.size}/{availableSkills.length}</span>
                      </div>
                      <div className="overflow-y-auto py-1 min-h-0">
                        {availableSkills.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noSkills')}</div>
                        )}
                        {availableSkills.map((skill) => (
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

                {/* 2. MCP */}
                <div ref={mcpPopupRef} className="relative">
                  <button
                    onClick={() => { setMcpPopupOpen((v) => !v); setSkillsPopupOpen(false); setAgentPopupOpen(false); setPluginPopupOpen(false); setTerminalPopupOpen(false) }}
                    title="MCP"
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">hub</span>
                  </button>
                  {mcpPopupOpen && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 w-[280px] max-h-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                        <p className="text-xs text-[var(--color-text-tertiary)]">{t('chat.mcpSelectHint')}</p>
                        <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedMcps.size}/{mcpServers.length}</span>
                      </div>
                      <div className="overflow-y-auto py-1 min-h-0">
                        {mcpServers.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noMcp')}</div>
                        )}
                        {mcpServers.map((server) => (
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
                                  mcpApi.toggle(server.name, workDir || undefined).catch(() => {})
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

                {/* 3. Agent */}
                <div ref={agentPopupRef} className="relative">
                  <button
                    onClick={() => { setAgentPopupOpen((v) => !v); setSkillsPopupOpen(false); setMcpPopupOpen(false); setPluginPopupOpen(false); setTerminalPopupOpen(false) }}
                    title="Agent"
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                  </button>
                  {agentPopupOpen && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 w-[280px] max-h-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                        <p className="text-xs text-[var(--color-text-tertiary)]">{t('chat.agentSelectHint')}</p>
                        <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedAgents.size}/{agents.length}</span>
                      </div>
                      <div className="overflow-y-auto py-1 min-h-0">
                        {agents.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noAgents')}</div>
                        )}
                        {agents.map((agent) => (
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

                {/* 4. Plugin */}
                <div ref={pluginPopupRef} className="relative">
                  <button
                    onClick={() => { setPluginPopupOpen((v) => !v); setSkillsPopupOpen(false); setMcpPopupOpen(false); setAgentPopupOpen(false); setTerminalPopupOpen(false) }}
                    title={t('chat.plugins')}
                    className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">extension</span>
                  </button>
                  {pluginPopupOpen && (
                    <div className="absolute bottom-full right-0 z-50 mb-2 w-[300px] max-h-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] overflow-hidden flex flex-col">
                      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
                        <p className="text-xs text-[var(--color-text-tertiary)]">{t('chat.pluginSelectHint')}</p>
                        <span className="text-[10px] text-[var(--color-text-secondary)]">{selectedPlugins.size}/{plugins.length}</span>
                      </div>
                      <div className="overflow-y-auto py-1 min-h-0">
                        {plugins.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('chat.noPlugins')}</div>
                        )}
                        {plugins.map((plugin) => (
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

                {/* 5. Terminal */}
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
                  cwd={workDir || undefined}
                  onCwdChange={(newWorkDir) => setWorkDir(newWorkDir)}
                />
              </div>

              <div className="flex items-center gap-3">
                <ModelSelector runtimeKey={DRAFT_RUNTIME_SELECTION_KEY} disabled={isSubmitting} />
                <button
                  onClick={handleSubmit}
                  disabled={(!input.trim() && attachments.length === 0) || isSubmitting}
                  className="flex w-[112px] items-center justify-center gap-1 rounded-lg bg-[image:var(--gradient-btn-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-all hover:brightness-105 disabled:opacity-30"
                >
                  {t('common.run')}
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </button>
              </div>
            </div>
          </div>

          <div>
            <DirectoryPicker value={workDir} onChange={setWorkDir} />
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}

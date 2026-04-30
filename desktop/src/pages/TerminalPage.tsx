import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import { useTranslation } from '../i18n'
import { terminalApi } from '../api/terminal'

type TerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error' | 'unavailable'

export function TerminalPage() {
  const t = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitRef = useRef<XTermFitAddon | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const [status, setStatus] = useState<TerminalStatus>(() => terminalApi.isAvailable() ? 'idle' : 'unavailable')
  const [error, setError] = useState<string | null>(null)
  const [shellInfo, setShellInfo] = useState<{ shell: string; cwd: string } | null>(null)

  const resizeSession = useCallback(() => {
    const terminal = terminalRef.current
    const fit = fitRef.current
    const sessionId = sessionIdRef.current
    if (!terminal || !fit) return

    fit.fit()
    if (sessionId) {
      void terminalApi.resize(sessionId, terminal.cols, terminal.rows).catch(() => {})
    }
  }, [])

  const startTerminal = useCallback(async () => {
    if (!terminalApi.isAvailable()) {
      setStatus('unavailable')
      return
    }

    const host = hostRef.current
    if (!host) return

    setError(null)
    setStatus('starting')
    setShellInfo(null)

    const existing = sessionIdRef.current
    if (existing) {
      await terminalApi.kill(existing).catch(() => {})
      sessionIdRef.current = null
    }
    unlistenRef.current.forEach((unlisten) => unlisten())
    unlistenRef.current = []

    terminalRef.current?.dispose()
    fitRef.current = null
    host.innerHTML = ''

    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "var(--font-mono), 'SFMono-Regular', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: {
        background: '#121212',
        foreground: '#d7d2d0',
        cursor: '#ffb59f',
        selectionBackground: '#5f4a40',
        black: '#1f1f1f',
        red: '#ff6d67',
        green: '#7ef18a',
        yellow: '#f8c55f',
        blue: '#77a8ff',
        magenta: '#d699ff',
        cyan: '#61d6d6',
        white: '#d7d2d0',
        brightBlack: '#8f8683',
        brightRed: '#ff8a85',
        brightGreen: '#9ff7a7',
        brightYellow: '#ffdd7a',
        brightBlue: '#a6c5ff',
        brightMagenta: '#e3b8ff',
        brightCyan: '#8ceeee',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit
    fit.fit()

    const outputUnlisten = await terminalApi.onOutput((payload) => {
      if (payload.session_id === sessionIdRef.current) {
        terminal.write(payload.data)
      }
    })
    const exitUnlisten = await terminalApi.onExit((payload) => {
      if (payload.session_id !== sessionIdRef.current) return
      setStatus('exited')
      const signal = payload.signal ? `, ${payload.signal}` : ''
      terminal.writeln(`\r\n[process exited: ${payload.code}${signal}]`)
      sessionIdRef.current = null
    })
    unlistenRef.current = [outputUnlisten, exitUnlisten]

    terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void terminalApi.write(sessionId, data).catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        })
      }
    })

    try {
      const result = await terminalApi.spawn({ cols: terminal.cols, rows: terminal.rows })
      sessionIdRef.current = result.session_id
      setShellInfo({ shell: result.shell, cwd: result.cwd })
      setStatus('running')
      resizeSession()
    } catch (err) {
      outputUnlisten()
      exitUnlisten()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [resizeSession])

  useEffect(() => {
    if (!terminalApi.isAvailable()) return
    void startTerminal()

    const observer = new ResizeObserver(() => resizeSession())
    if (hostRef.current) observer.observe(hostRef.current)

    return () => {
      observer.disconnect()
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void terminalApi.kill(sessionId).catch(() => {})
      }
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
      unlistenRef.current.forEach((unlisten) => unlisten())
      unlistenRef.current = []
      sessionIdRef.current = null
    }
  }, [resizeSession, startTerminal])

  const clearTerminal = () => {
    terminalRef.current?.clear()
  }

  const getStatusLabel = (status: TerminalStatus): string => {
    switch (status) {
      case 'idle': return t('terminal.status.idle')
      case 'starting': return t('terminal.status.starting')
      case 'running': return t('terminal.status.running')
      case 'exited': return t('terminal.status.exited')
      case 'error': return t('terminal.status.error')
      case 'unavailable': return t('terminal.status.unavailable')
      default: return status
    }
  }

  const getStatusColor = (status: TerminalStatus): string => {
    switch (status) {
      case 'running': return 'bg-green-500'
      case 'error': return 'bg-red-500'
      case 'starting': return 'bg-yellow-500'
      default: return 'bg-gray-400'
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('terminal.title')}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-tertiary)]">
            {t('terminal.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void startTerminal()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-text-primary)] px-3 text-sm font-medium text-[var(--color-surface)] transition-colors hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t('terminal.newTerminal')}
          </button>
          <button
            type="button"
            onClick={clearTerminal}
            disabled={!terminalRef.current}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">mop</span>
            {t('terminal.clear')}
          </button>
          <button
            type="button"
            onClick={() => void startTerminal()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
            {t('terminal.restart')}
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-6 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2.5 py-1">
          <span className={`h-1.5 w-1.5 rounded-full ${getStatusColor(status)}`} />
          <span className="text-[var(--color-text-secondary)]">{getStatusLabel(status)}</span>
        </span>
        {shellInfo && (
          <>
            <span className="font-mono text-[var(--color-text-tertiary)]">{shellInfo.shell}</span>
            <span className="text-[var(--color-border)]">/</span>
            <span className="max-w-md truncate font-mono text-[var(--color-text-tertiary)]">{shellInfo.cwd}</span>
          </>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="shrink-0 border-b border-[var(--color-error)]/20 bg-[var(--color-error)]/10 px-6 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {/* Terminal Container */}
      {status === 'unavailable' ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-center">
            <span className="material-symbols-outlined mb-3 block text-[48px] text-[var(--color-text-tertiary)]">
              desktop_windows
            </span>
            <p className="text-base font-medium text-[var(--color-text-primary)]">
              {t('terminal.unavailableTitle')}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
              {t('terminal.unavailableBody')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden p-4">
          <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] shadow-[var(--shadow-dropdown)]">
            {/* Terminal Title Bar */}
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-danger)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-accent)]" />
              <span className="ml-2 truncate font-mono text-[11px] text-[var(--color-terminal-muted)]">
                {t('terminal.windowTitle')}
              </span>
            </div>
            {/* Terminal Host */}
            <div
              ref={hostRef}
              className="flex-1 overflow-hidden p-2"
            />
          </div>
        </div>
      )}
    </div>
  )
}

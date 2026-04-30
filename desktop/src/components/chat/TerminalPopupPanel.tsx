import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { terminalApi } from '../../api/terminal'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'

type Props = {
  cwd?: string
  onClose: () => void
}

export function TerminalPopupPanel({ cwd, onClose }: Props) {
  const t = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitRef = useRef<XTermFitAddon | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const [error, setError] = useState<string | null>(null)

  const resizeSession = useCallback(() => {
    const terminal = terminalRef.current
    const fit = fitRef.current
    if (!terminal || !fit) return
    fit.fit()
    const sid = sessionIdRef.current
    if (sid) { void terminalApi.resize(sid, terminal.cols, terminal.rows).catch(() => {}) }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!terminalApi.isAvailable()) {
        setError(t('settings.terminal.unavailableTitle'))
        return
      }

      const host = hostRef.current
      if (!host) return

      setError(null)

      // Clean up previous session
      const existing = sessionIdRef.current
      if (existing) { await terminalApi.kill(existing).catch(() => {}) }
      unlistenRef.current.forEach((u) => u())
      unlistenRef.current = []

      terminalRef.current?.dispose()
      fitRef.current = null
      host.innerHTML = ''

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])

      if (cancelled) return

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: false,
        fontFamily: "var(--font-mono), 'SFMono-Regular', Consolas, monospace",
        fontSize: 11.5,
        lineHeight: 1.25,
        scrollback: 2000,
        theme: {
          background: '#121212',
          foreground: '#d7d2d0',
          cursor: '#ffb59f',
          selectionBackground: '#5f4a40',
          black: '#1f1f1f', red: '#ff6d67', green: '#7ef18a', yellow: '#f8c55f',
          blue: '#77a8ff', magenta: '#d699ff', cyan: '#61d6d6', white: '#d7d2d0',
          brightBlack: '#8f8683', brightRed: '#ff8a85', brightGreen: '#9ff7a7',
          brightYellow: '#ffdd7a', brightBlue: '#a6c5ff', brightMagenta: '#e3b8ff',
          brightCyan: '#8ceeee', brightWhite: '#ffffff',
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
        const signal = payload.signal ? `, ${payload.signal}` : ''
        terminal.writeln(`\r\n[process exited: ${payload.code}${signal}]`)
        sessionIdRef.current = null
      })
      unlistenRef.current = [outputUnlisten, exitUnlisten]

      terminal.onData((data) => {
        const sid = sessionIdRef.current
        if (sid) {
          void terminalApi.write(sid, data).catch(() => {})
        }
      })

      try {
        const result = await terminalApi.spawn({
          cols: terminal.cols, rows: terminal.rows, cwd,
        })
        if (cancelled) return
        sessionIdRef.current = result.session_id
        resizeSession()
      } catch (err) {
        outputUnlisten()
        exitUnlisten()
        terminal.dispose()
        terminalRef.current = null
        fitRef.current = null
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void init()

    const observer = new ResizeObserver(() => resizeSession())
    if (hostRef.current) observer.observe(hostRef.current)

    return () => {
      cancelled = true
      observer.disconnect()
      const sid = sessionIdRef.current
      if (sid) { void terminalApi.kill(sid).catch(() => {}) }
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
      unlistenRef.current.forEach((u) => u())
      unlistenRef.current = []
      sessionIdRef.current = null
    }
  }, [cwd, t, resizeSession])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Title bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-3 py-1.5">
        <div className="flex gap-1.5">
          <div className="h-2 w-2 rounded-full bg-[var(--color-terminal-danger)]" />
          <div className="h-2 w-2 rounded-full bg-[var(--color-terminal-warning)]" />
          <div className="h-2 w-2 rounded-full bg-[var(--color-terminal-accent)]" />
        </div>
        <span className="ml-1 truncate font-mono text-[10px] text-[var(--color-terminal-muted)]">
          {t('chat.terminal')}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-0.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>

      {/* Content */}
      {error ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-[var(--color-error)]">
          {error}
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-1.5">
          <div ref={hostRef} className="h-full w-full" />
        </div>
      )}
    </div>
  )
}

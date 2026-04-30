import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import type { SessionListItem } from '../types/session'

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  availableProjects: string[]
  sessionWorkDirs: Record<string, string>

  fetchSessions: (project?: string) => Promise<void>
  createSession: (workDir?: string) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setSelectedProjects: (projects: string[]) => void
  setSessionWorkDir: (id: string, workDir: string) => void
  getWorkDir: (id: string) => string | undefined
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectedProjects: [],
  availableProjects: [],
  sessionWorkDirs: {},

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      const byId = new Map<string, SessionListItem>()
      for (const s of raw) {
        const existing = byId.get(s.id)
        if (!existing || new Date(s.modifiedAt) > new Date(existing.modifiedAt)) {
          byId.set(s.id, s)
        }
      }
      const prevSessions = get().sessions
      const sessions = [...byId.values()].map(s => {
        const prev = prevSessions.find(p => p.id === s.id)
        if (prev && prev.workDir && !s.workDir) {
          return { ...s, workDir: prev.workDir, workDirExists: prev.workDirExists ?? true }
        }
        return s
      })
      const availableProjects = [...new Set(sessions.map((s) => s.projectPath).filter(Boolean))].sort()
      set({ sessions, availableProjects, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  createSession: async (workDir?: string) => {
    const { sessionId: id } = await sessionsApi.create(workDir || undefined)
    const now = new Date().toISOString()
    const optimisticSession: SessionListItem = {
      id,
      title: 'New Session',
      createdAt: now,
      modifiedAt: now,
      messageCount: 0,
      projectPath: '',
      workDir: workDir ?? null,
      workDirExists: true,
    }

    set((state) => ({
      sessions: state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: id,
      sessionWorkDirs: workDir ? { ...state.sessionWorkDirs, [id]: workDir } : state.sessionWorkDirs,
    }))

    void get().fetchSessions()
    return id
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id)
    useSessionRuntimeStore.getState().clearSelection(id)
    set((s) => ({
      sessions: s.sessions.filter((session) => session.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    }))
  },

  renameSession: async (id: string, title: string) => {
    await sessionsApi.rename(id, title)
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  updateSessionTitle: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),
  setSessionWorkDir: (id, workDir) => set((state) => ({
    sessionWorkDirs: { ...state.sessionWorkDirs, [id]: workDir },
    sessions: state.sessions.map(s => s.id === id ? { ...s, workDir, workDirExists: true } : s),
  })),
  getWorkDir: (id) => {
    const state = get()
    const session = state.sessions.find(s => s.id === id)
    return state.sessionWorkDirs[id] || session?.workDir || undefined
  },
}))

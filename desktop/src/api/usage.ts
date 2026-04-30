import { api } from './client'

export type ServerUsageStats = {
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
}

export type ServerDiagnostics = {
  nodeVersion: string
  bunVersion: string
  platform: string
  arch: string
  configDir: string
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
  }
}

export type ServerHealth = {
  status: string
  version: string
  uptime: number
}

export const usageApi = {
  /** 获取服务器实时用量统计 */
  getUsageStats() {
    return api.get<ServerUsageStats>('/api/status/usage')
  },

  /** 获取服务器诊断信息 */
  getDiagnostics() {
    return api.get<ServerDiagnostics>('/api/status/diagnostics')
  },

  /** 获取服务器健康状态 */
  getHealth() {
    return api.get<ServerHealth>('/api/status')
  },
}

import { create } from 'zustand'
import { usageApi, type ServerUsageStats } from '../api/usage'

const STORAGE_KEY = 'cc-haha-usage-data'
const PRICING_KEY = 'cc-haha-provider-pricing'
const REQUEST_LIMIT_KEY = 'cc-haha-request-limits'
const PROVIDER_MODEL_CONFIG_KEY = 'cc-haha-provider-model-configs'

export type RequestLimitPeriod = 'per5hours' | 'daily' | 'weekly' | 'monthly'

export type ModelUsageMode = 'pay_as_you_go' | 'codingplan'

export type RequestLimit = {
  provider: string
  model: string
  per5hours: number
  daily: number
  weekly: number
  monthly: number
}

export type ProviderModelConfig = {
  provider: string
  model: string
  usageMode: ModelUsageMode
  customStartTime?: number  // 每5小时周期的自定义起始时间（时间戳）
}

export type UsageRecord = {
  id: string
  timestamp: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  sessionId: string
  requestCount: number
}

export type ProviderPricing = {
  provider: string
  inputPricePerMillion: number
  outputPricePerMillion: number
  cacheReadPricePerMillion: number
  cacheCreationPricePerMillion: number
  currency: string
  lastUpdated: number
  manualOverride: boolean
}

const DEFAULT_PRICING: ProviderPricing[] = [
  {
    provider: 'anthropic',
    inputPricePerMillion: 21,
    outputPricePerMillion: 105,
    cacheReadPricePerMillion: 2.1,
    cacheCreationPricePerMillion: 31.5,
    currency: 'CNY',
    lastUpdated: Date.now(),
    manualOverride: false,
  },
  {
    provider: 'openai',
    inputPricePerMillion: 17.5,
    outputPricePerMillion: 70,
    cacheReadPricePerMillion: 8.75,
    cacheCreationPricePerMillion: 0,
    currency: 'CNY',
    lastUpdated: Date.now(),
    manualOverride: false,
  },
  {
    provider: 'google',
    inputPricePerMillion: 10.5,
    outputPricePerMillion: 42,
    cacheReadPricePerMillion: 2.63,
    cacheCreationPricePerMillion: 0,
    currency: 'CNY',
    lastUpdated: Date.now(),
    manualOverride: false,
  },
  {
    provider: 'deepseek',
    inputPricePerMillion: 1.4,
    outputPricePerMillion: 5.6,
    cacheReadPricePerMillion: 0.35,
    cacheCreationPricePerMillion: 0,
    currency: 'CNY',
    lastUpdated: Date.now(),
    manualOverride: false,
  },
  {
    provider: 'openrouter',
    inputPricePerMillion: 14,
    outputPricePerMillion: 56,
    cacheReadPricePerMillion: 3.5,
    cacheCreationPricePerMillion: 0,
    currency: 'CNY',
    lastUpdated: Date.now(),
    manualOverride: false,
  },
]

function loadRecords(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const records: UsageRecord[] = JSON.parse(raw)
    return records.map(r => ({ ...r, requestCount: r.requestCount ?? 1 }))
  } catch { return [] }
}

function saveRecords(records: UsageRecord[]) {
  try {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    const filtered = records.filter(r => r.timestamp > cutoff)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  } catch {}
}

function loadPricing(): ProviderPricing[] {
  try {
    const raw = localStorage.getItem(PRICING_KEY)
    return raw ? JSON.parse(raw) : DEFAULT_PRICING
  } catch { return DEFAULT_PRICING }
}

function savePricing(pricing: ProviderPricing[]) {
  try { localStorage.setItem(PRICING_KEY, JSON.stringify(pricing)) } catch {}
}

function loadRequestLimits(): RequestLimit[] {
  try {
    const raw = localStorage.getItem(REQUEST_LIMIT_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveRequestLimits(limits: RequestLimit[]) {
  try {
    localStorage.setItem(REQUEST_LIMIT_KEY, JSON.stringify(limits))
  } catch {}
}

function loadProviderModelConfigs(): ProviderModelConfig[] {
  try {
    const raw = localStorage.getItem(PROVIDER_MODEL_CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveProviderModelConfigs(configs: ProviderModelConfig[]) {
  try {
    localStorage.setItem(PROVIDER_MODEL_CONFIG_KEY, JSON.stringify(configs))
  } catch {}
}

type UsageStore = {
  records: UsageRecord[]
  pricing: ProviderPricing[]
  requestLimits: RequestLimit[]
  providerModelConfigs: ProviderModelConfig[]
  serverStats: ServerUsageStats | null
  isLoadingServerStats: boolean
  serverStatsError: string | null

  addRecord: (record: Omit<UsageRecord, 'id'>) => void
  clearRecords: () => void
  getRecordsForPeriod: (start: number, end: number) => UsageRecord[]
  getProviderAggregation: (start: number, end: number) => Array<{
    provider: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
    requestCount: number
    inputCost: number
    outputCost: number
    cacheReadCost: number
    cacheCreationCost: number
    totalCost: number
  }>
  getDailyAggregation: (start: number, end: number) => Array<{
    date: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: number
    requestCount: number
  }>
  updatePricing: (provider: string, pricing: Partial<ProviderPricing>) => void
  resetPricing: (provider: string) => void
  getPricingForProvider: (provider: string) => ProviderPricing | undefined
  getRequestLimit: (provider: string, model: string) => RequestLimit | undefined
  updateRequestLimit: (provider: string, model: string, limit: Partial<RequestLimit>) => void
  getRequestCountForPeriod: (provider: string, model: string, start: number, end: number) => number
  getProviderModelConfig: (provider: string, model: string) => ProviderModelConfig | undefined
  updateProviderModelConfig: (provider: string, model: string, config: Partial<ProviderModelConfig>) => void
  getRequestStatsByPeriod: (start: number, end: number) => Array<{
    period: RequestLimitPeriod
    provider: string
    model: string
    requestCount: number
    limit: number
    usagePercent: number
  }>
  refreshRecords: () => Promise<void>
  refreshServerStats: () => Promise<void>
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  records: loadRecords(),
  pricing: loadPricing(),
  requestLimits: loadRequestLimits(),
  providerModelConfigs: loadProviderModelConfigs(),
  serverStats: null,
  isLoadingServerStats: false,
  serverStatsError: null,

  addRecord: (record) => {
    const newRecord: UsageRecord = { ...record, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
    set(state => {
      const records = [...state.records, newRecord]
      saveRecords(records)
      return { records }
    })
  },

  clearRecords: () => {
    set({ records: [] })
    saveRecords([])
  },

  getRecordsForPeriod: (start, end) => {
    return get().records.filter(r => r.timestamp >= start && r.timestamp < end)
  },

  getProviderAggregation: (start, end) => {
    const records = get().records.filter(r => r.timestamp >= start && r.timestamp < end)
    const pricing = get().pricing
    const providerMap = new Map<string, {
      provider: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      requestCount: number
    }>()

    for (const r of records) {
      const existing = providerMap.get(r.provider)
      if (existing) {
        existing.inputTokens += r.inputTokens
        existing.outputTokens += r.outputTokens
        existing.cacheReadTokens += r.cacheReadTokens
        existing.cacheCreationTokens += r.cacheCreationTokens
        existing.requestCount += r.requestCount
      } else {
        providerMap.set(r.provider, {
          provider: r.provider,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cacheReadTokens: r.cacheReadTokens,
          cacheCreationTokens: r.cacheCreationTokens,
          requestCount: r.requestCount,
        })
      }
    }

    return Array.from(providerMap.values()).map(p => {
      const pPricing = pricing.find(pr => pr.provider === p.provider)
      const inputCost = (p.inputTokens / 1_000_000) * (pPricing?.inputPricePerMillion || 0)
      const outputCost = (p.outputTokens / 1_000_000) * (pPricing?.outputPricePerMillion || 0)
      const cacheReadCost = (p.cacheReadTokens / 1_000_000) * (pPricing?.cacheReadPricePerMillion || 0)
      const cacheCreationCost = (p.cacheCreationTokens / 1_000_000) * (pPricing?.cacheCreationPricePerMillion || 0)
      return {
        ...p,
        totalTokens: p.inputTokens + p.outputTokens,
        inputCost,
        outputCost,
        cacheReadCost,
        cacheCreationCost,
        totalCost: inputCost + outputCost + cacheReadCost + cacheCreationCost,
      }
    }).sort((a, b) => b.totalCost - a.totalCost)
  },

  getDailyAggregation: (start, end) => {
    const records = get().records.filter(r => r.timestamp >= start && r.timestamp < end)
    const pricing = get().pricing
    const dayMap = new Map<string, { inputTokens: number; outputTokens: number; cost: number; requestCount: number }>()

    for (const r of records) {
      const day = new Date(r.timestamp).toISOString().slice(0, 10)
      const existing = dayMap.get(day)
      const pPricing = pricing.find(pr => pr.provider === r.provider)
      const cost =
        (r.inputTokens / 1_000_000) * (pPricing?.inputPricePerMillion || 0) +
        (r.outputTokens / 1_000_000) * (pPricing?.outputPricePerMillion || 0) +
        (r.cacheReadTokens / 1_000_000) * (pPricing?.cacheReadPricePerMillion || 0) +
        (r.cacheCreationTokens / 1_000_000) * (pPricing?.cacheCreationPricePerMillion || 0)

      if (existing) {
        existing.inputTokens += r.inputTokens
        existing.outputTokens += r.outputTokens
        existing.cost += cost
        existing.requestCount += r.requestCount
      } else {
        dayMap.set(day, { inputTokens: r.inputTokens, outputTokens: r.outputTokens, cost, requestCount: r.requestCount })
      }
    }

    return Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, ...data, totalTokens: data.inputTokens + data.outputTokens }))
      .sort((a, b) => a.date.localeCompare(b.date))
  },

  updatePricing: (provider, updates) => {
    set(state => {
      const pricing = state.pricing.map(p =>
        p.provider === provider ? { ...p, ...updates, manualOverride: true, lastUpdated: Date.now() } : p
      )
      if (!pricing.find(p => p.provider === provider)) {
        pricing.push({
          provider,
          inputPricePerMillion: updates.inputPricePerMillion || 0,
          outputPricePerMillion: updates.outputPricePerMillion || 0,
          cacheReadPricePerMillion: updates.cacheReadPricePerMillion || 0,
          cacheCreationPricePerMillion: updates.cacheCreationPricePerMillion || 0,
          currency: 'CNY',
          lastUpdated: Date.now(),
          manualOverride: true,
          ...updates,
        })
      }
      savePricing(pricing)
      return { pricing }
    })
  },

  resetPricing: (provider) => {
    const defaultPricing = DEFAULT_PRICING.find(p => p.provider === provider)
    if (defaultPricing) {
      set(state => {
        const pricing = state.pricing.map(p =>
          p.provider === provider ? { ...defaultPricing, lastUpdated: Date.now() } : p
        )
        savePricing(pricing)
        return { pricing }
      })
    }
  },

  getPricingForProvider: (provider) => {
    return get().pricing.find(p => p.provider === provider)
  },

  getRequestLimit: (provider, model) => {
    return get().requestLimits.find(l => l.provider === provider && l.model === model)
  },

  updateRequestLimit: (provider, model, limit) => {
    set(state => {
      const existing = state.requestLimits.findIndex(l => l.provider === provider && l.model === model)
      const requestLimits = [...state.requestLimits]
      if (existing >= 0) {
        requestLimits[existing] = { ...requestLimits[existing], ...limit } as RequestLimit
      } else {
        requestLimits.push({
          provider,
          model,
          per5hours: limit.per5hours ?? 0,
          daily: limit.daily ?? 0,
          weekly: limit.weekly ?? 0,
          monthly: limit.monthly ?? 0,
        })
      }
      saveRequestLimits(requestLimits)
      return { requestLimits }
    })
  },

  getRequestCountForPeriod: (provider, model, start, end) => {
    return get().records.filter(r =>
      r.provider === provider &&
      r.model === model &&
      r.timestamp >= start &&
      r.timestamp < end
    ).reduce((sum, r) => sum + r.requestCount, 0)
  },

  getProviderModelConfig: (provider, model) => {
    return get().providerModelConfigs.find(c => c.provider === provider && c.model === model)
  },

  updateProviderModelConfig: (provider, model, config) => {
    set(state => {
      const existing = state.providerModelConfigs.findIndex(c => c.provider === provider && c.model === model)
      const providerModelConfigs = [...state.providerModelConfigs]
      if (existing >= 0) {
        providerModelConfigs[existing] = { ...providerModelConfigs[existing], ...config } as ProviderModelConfig
      } else {
        providerModelConfigs.push({
          provider,
          model,
          usageMode: config.usageMode || 'pay_as_you_go',
          customStartTime: config.customStartTime,
        })
      }
      saveProviderModelConfigs(providerModelConfigs)
      return { providerModelConfigs }
    })
  },

  getRequestStatsByPeriod: (_start, _end) => {
    const state = get()
    const stats: Array<{
      period: RequestLimitPeriod
      provider: string
      model: string
      requestCount: number
      limit: number
      usagePercent: number
    }> = []

    const periods: RequestLimitPeriod[] = ['per5hours', 'daily', 'weekly', 'monthly']
    const now = Date.now()

    for (const limit of state.requestLimits) {
      const config = state.providerModelConfigs.find(c => c.provider === limit.provider && c.model === limit.model)

      for (const period of periods) {
        let periodStart: number
        let periodEnd: number

        if (period === 'per5hours') {
          if (config?.customStartTime) {
            const elapsed = now - config.customStartTime
            const periodsElapsed = Math.floor(elapsed / (5 * 60 * 60 * 1000))
            periodStart = config.customStartTime + periodsElapsed * 5 * 60 * 60 * 1000
            periodEnd = periodStart + 5 * 60 * 60 * 1000
          } else {
            periodStart = now - 5 * 60 * 60 * 1000
            periodEnd = now
          }
        } else if (period === 'daily') {
          const dayStart = new Date()
          dayStart.setHours(0, 0, 0, 0)
          periodStart = dayStart.getTime()
          periodEnd = now
        } else if (period === 'weekly') {
          const weekStart = new Date()
          weekStart.setHours(0, 0, 0, 0)
          const dayOfWeek = weekStart.getDay() || 7
          weekStart.setDate(weekStart.getDate() - (dayOfWeek - 1))
          periodStart = weekStart.getTime()
          periodEnd = now
        } else {
          const monthStart = new Date()
          monthStart.setDate(1)
          monthStart.setHours(0, 0, 0, 0)
          periodStart = monthStart.getTime()
          periodEnd = now
        }

        const requestCount = state.records.filter(r =>
          r.provider === limit.provider &&
          r.model === limit.model &&
          r.timestamp >= periodStart &&
          r.timestamp < periodEnd
        ).reduce((sum, r) => sum + r.requestCount, 0)

        const limitValue = limit[period] || 0
        const usagePercent = limitValue > 0 ? (requestCount / limitValue) * 100 : 0

        stats.push({
          period,
          provider: limit.provider,
          model: limit.model,
          requestCount,
          limit: limitValue,
          usagePercent,
        })
      }
    }

    return stats
  },

  refreshRecords: async () => {
    const records = loadRecords()
    const pricing = loadPricing()
    const requestLimits = loadRequestLimits()
    const providerModelConfigs = loadProviderModelConfigs()
    set({ records, pricing, requestLimits, providerModelConfigs })
  },

  refreshServerStats: async () => {
    set({ isLoadingServerStats: true, serverStatsError: null })
    try {
      const stats = await usageApi.getUsageStats()
      set({ serverStats: stats, isLoadingServerStats: false })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch server stats'
      set({ serverStatsError: errorMessage, isLoadingServerStats: false })
    }
  },
}))

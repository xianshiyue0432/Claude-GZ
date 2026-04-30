import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Line, Area, AreaChart,
} from 'recharts'
import { useUsageStore, type RequestLimitPeriod, type ModelUsageMode } from '../../stores/usageStore'

type Period = 'today' | 'week' | 'month' | 'quarter' | 'year'

function getPeriodRange(period: Period): { start: number; end: number } {
  const now = new Date()
  const end = now.getTime()
  let start: number
  if (period === 'today') {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    start = dayStart.getTime()
  } else if (period === 'week') {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayOfWeek = dayStart.getDay() || 7
    start = dayStart.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  } else if (period === 'quarter') {
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3
    start = new Date(now.getFullYear(), quarterMonth, 1).getTime()
  } else {
    start = new Date(now.getFullYear(), 0, 1).getTime()
  }
  return { start, end }
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

function formatCost(n: number): string {
  if (!isFinite(n)) return '¥0.00'
  if (n >= 1000) return `¥${n.toFixed(2)}`
  if (n >= 1) return `¥${n.toFixed(3)}`
  if (n >= 0.01) return `¥${n.toFixed(4)}`
  return `¥${n.toFixed(6)}`
}

const CHART_COLORS = ['#3B82F6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#F97316']

const REQUEST_LIMIT_LABELS: Record<RequestLimitPeriod, string> = {
  per5hours: '每5小时',
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
}

const MODEL_USAGE_MODE_LABELS: Record<ModelUsageMode, string> = {
  pay_as_you_go: '按量模式',
  codingplan: 'CodingPlan模式',
}

export function CostManagementSettings() {
  const [period, setPeriod] = useState<Period>('month')
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [editPrices, setEditPrices] = useState({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [editingLimit, setEditingLimit] = useState<{ provider: string; model: string } | null>(null)
  const [editLimits, setEditLimits] = useState({ per5hours: 0, daily: 0, weekly: 0, monthly: 0 })
  const [editingMode, setEditingMode] = useState<{ provider: string; model: string } | null>(null)
  const [editMode, setEditMode] = useState<ModelUsageMode>('pay_as_you_go')
  const [editStartTime, setEditStartTime] = useState<string>('')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { records, pricing, serverStats, isLoadingServerStats, serverStatsError, getProviderAggregation, getDailyAggregation, updatePricing, resetPricing, clearRecords, refreshRecords, refreshServerStats, getRequestLimit, updateRequestLimit, getProviderModelConfig, updateProviderModelConfig, getRequestStatsByPeriod } = useUsageStore()

  const { start, end } = useMemo(() => getPeriodRange(period), [period])

  const providerData = useMemo(() => getProviderAggregation(start, end), [getProviderAggregation, start, end])
  const dailyData = useMemo(() => getDailyAggregation(start, end), [getDailyAggregation, start, end])

  const summary = useMemo(() => {
    const periodRecords = records.filter(r => r.timestamp >= start && r.timestamp < end)
    const totalInput = periodRecords.reduce((s, r) => s + r.inputTokens, 0)
    const totalOutput = periodRecords.reduce((s, r) => s + r.outputTokens, 0)
    const totalCost = providerData.reduce((s, p) => s + p.totalCost, 0)
    const totalRequests = periodRecords.reduce((s, r) => s + r.requestCount, 0)
    return { totalInput, totalOutput, totalTokens: totalInput + totalOutput, totalCost, recordCount: periodRecords.length, totalRequests }
  }, [records, start, end, providerData])

  const barChartData = useMemo(() => {
    return providerData.map(p => ({
      name: p.provider,
      输入Token: p.inputTokens,
      输出Token: p.outputTokens,
    }))
  }, [providerData])

  const costCurveData = useMemo(() => {
    if (dailyData.length === 0) return []
    let cumulative = 0
    return dailyData.map(d => {
      cumulative += d.cost
      return { date: d.date.slice(5), 当日费用: +d.cost.toFixed(4), 累计费用: +cumulative.toFixed(4) }
    })
  }, [dailyData])

  const handleEditProvider = useCallback((provider: string) => {
    const p = pricing.find(pr => pr.provider === provider)
    setEditPrices({
      input: p?.inputPricePerMillion || 0,
      output: p?.outputPricePerMillion || 0,
      cacheRead: p?.cacheReadPricePerMillion || 0,
      cacheCreation: p?.cacheCreationPricePerMillion || 0,
    })
    setEditingProvider(provider)
  }, [pricing])

  const handleSavePricing = useCallback(() => {
    if (!editingProvider) return
    updatePricing(editingProvider, {
      inputPricePerMillion: editPrices.input,
      outputPricePerMillion: editPrices.output,
      cacheReadPricePerMillion: editPrices.cacheRead,
      cacheCreationPricePerMillion: editPrices.cacheCreation,
    })
    setEditingProvider(null)
  }, [editingProvider, editPrices, updatePricing])

  const handleResetPricing = useCallback((provider: string) => {
    resetPricing(provider)
  }, [resetPricing])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([
        refreshRecords(),
        refreshServerStats(),
      ])
    } finally {
      setIsRefreshing(false)
    }
  }, [refreshRecords, refreshServerStats])

  useEffect(() => {
    refreshServerStats()
  }, [refreshServerStats])

  const periodLabel: Record<Period, string> = { today: '今日', week: '本周', month: '本月', quarter: '本季', year: '本年度' }

  const providerModelData = useMemo(() => {
    const periodRecords = records.filter(r => r.timestamp >= start && r.timestamp < end)
    const map = new Map<string, Map<string, { inputTokens: number; outputTokens: number; requestCount: number }>>()
    for (const r of periodRecords) {
      if (!map.has(r.provider)) map.set(r.provider, new Map())
      const modelMap = map.get(r.provider)!
      const existing = modelMap.get(r.model)
      if (existing) {
        existing.inputTokens += r.inputTokens
        existing.outputTokens += r.outputTokens
        existing.requestCount += r.requestCount
      } else {
        modelMap.set(r.model, { inputTokens: r.inputTokens, outputTokens: r.outputTokens, requestCount: r.requestCount })
      }
    }
    return map
  }, [records, start, end])

  const handleEditLimit = useCallback((provider: string, model: string) => {
    const limit = getRequestLimit(provider, model)
    setEditLimits({
      per5hours: limit?.per5hours || 0,
      daily: limit?.daily || 0,
      weekly: limit?.weekly || 0,
      monthly: limit?.monthly || 0,
    })
    setEditingLimit({ provider, model })
  }, [getRequestLimit])

  const handleSaveLimit = useCallback(() => {
    if (!editingLimit) return
    updateRequestLimit(editingLimit.provider, editingLimit.model, editLimits)
    setEditingLimit(null)
  }, [editingLimit, editLimits, updateRequestLimit])

  const handleEditMode = useCallback((provider: string, model: string) => {
    const config = getProviderModelConfig(provider, model)
    setEditMode(config?.usageMode || 'pay_as_you_go')
    setEditStartTime(config?.customStartTime ? new Date(config.customStartTime).toISOString().slice(0, 16) : '')
    setEditingMode({ provider, model })
  }, [getProviderModelConfig])

  const handleSaveMode = useCallback(() => {
    if (!editingMode) return
    updateProviderModelConfig(editingMode.provider, editingMode.model, {
      usageMode: editMode,
      customStartTime: editStartTime ? new Date(editStartTime).getTime() : undefined,
    })
    setEditingMode(null)
  }, [editingMode, editMode, editStartTime, updateProviderModelConfig])

  const requestStats = useMemo(() => getRequestStatsByPeriod(start, end), [getRequestStatsByPeriod, start, end])

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-blue-900">成本管理</h3>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[14px] ${isRefreshing ? 'animate-spin' : ''}`}>refresh</span>
          刷新
        </button>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 p-0.5">
          {(['today', 'week', 'month', 'quarter', 'year'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-[11px] transition-colors ${
                period === p ? 'bg-blue-500 text-white' : 'text-blue-600 hover:text-blue-800'
              }`}>
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Server real-time stats */}
      {serverStats && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-green-600 uppercase tracking-wider font-medium">服务器实时统计</div>
            {isLoadingServerStats && <span className="text-[9px] text-green-500">更新中...</span>}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-4">
            <div>
              <div className="text-[9px] text-green-600">输入 Token</div>
              <div className="text-sm font-bold text-green-700">{formatNumber(serverStats.totalInputTokens)}</div>
            </div>
            <div>
              <div className="text-[9px] text-green-600">输出 Token</div>
              <div className="text-sm font-bold text-green-700">{formatNumber(serverStats.totalOutputTokens)}</div>
            </div>
            <div>
              <div className="text-[9px] text-green-600">总费用</div>
              <div className="text-sm font-bold text-green-700">{formatCost(serverStats.totalCost)}</div>
            </div>
          </div>
          {serverStatsError && (
            <div className="mt-2 text-[9px] text-red-500">{serverStatsError}</div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">总 Token</div>
          <div className="mt-1 text-lg font-bold text-blue-600">{formatNumber(summary.totalTokens)}</div>
          <div className="mt-0.5 text-[9px] text-blue-400">输入 {formatNumber(summary.totalInput)} / 输出 {formatNumber(summary.totalOutput)}</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">总金额</div>
          <div className="mt-1 text-lg font-bold text-blue-600">{formatCost(summary.totalCost)}</div>
          <div className="mt-0.5 text-[9px] text-blue-400">{periodLabel[period]}累计</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">请求次数</div>
          <div className="mt-1 text-lg font-bold text-blue-600">{formatNumber(summary.totalRequests)}</div>
          <div className="mt-0.5 text-[9px] text-blue-400">{periodLabel[period]}总请求</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">记录数</div>
          <div className="mt-1 text-lg font-bold text-blue-600">{summary.recordCount}</div>
          <div className="mt-0.5 text-[9px] text-blue-400">{periodLabel[period]}记录</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-[10px] text-blue-600 uppercase tracking-wider">提供商数</div>
          <div className="mt-1 text-lg font-bold text-blue-600">{providerData.length}</div>
          <div className="mt-0.5 text-[9px] text-blue-400">活跃提供商</div>
        </div>
      </div>

      {/* Provider Model Usage Mode & Request Stats */}
      {providerData.length > 0 && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <div className="mb-3 text-[11px] font-semibold text-purple-800">提供商模型使用方式与请求统计</div>
          <div className="space-y-4">
            {providerData.map(provider => (
              <div key={provider.provider} className="rounded-md border border-purple-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-purple-700">{provider.provider}</span>
                  <button
                    onClick={() => setExpandedProvider(expandedProvider === provider.provider ? null : provider.provider)}
                    className="text-[10px] text-purple-600 hover:text-purple-800"
                  >
                    {expandedProvider === provider.provider ? '收起' : '展开'}
                  </button>
                </div>

                {expandedProvider === provider.provider && providerModelData.has(provider.provider) && (
                  <div className="mt-3 space-y-3">
                    {Array.from(providerModelData.get(provider.provider)!.entries()).map(([model, data]) => {
                      const config = getProviderModelConfig(provider.provider, model)
                      const limit = getRequestLimit(provider.provider, model)
                      const isCodingPlan = config?.usageMode === 'codingplan'

                      return (
                        <div key={model} className="rounded border border-gray-200 p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-gray-700">{model}</span>
                            <div className="flex gap-2">
                              {editingMode?.provider === provider.provider && editingMode?.model === model ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={editMode}
                                    onChange={(e) => setEditMode(e.target.value as ModelUsageMode)}
                                    className="rounded border border-gray-300 px-2 py-1 text-[9px]"
                                  >
                                    <option value="pay_as_you_go">按量模式</option>
                                    <option value="codingplan">CodingPlan模式</option>
                                  </select>
                                  {editMode === 'codingplan' && (
                                    <input
                                      type="datetime-local"
                                      value={editStartTime}
                                      onChange={(e) => setEditStartTime(e.target.value)}
                                      className="rounded border border-gray-300 px-1 py-1 text-[8px]"
                                      placeholder="5小时周期起始时间"
                                    />
                                  )}
                                  <button
                                    onClick={handleSaveMode}
                                    className="rounded bg-green-500 px-2 py-1 text-[8px] text-white hover:bg-green-600"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={() => setEditingMode(null)}
                                    className="rounded bg-gray-400 px-2 py-1 text-[8px] text-white hover:bg-gray-500"
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleEditMode(provider.provider, model)}
                                  className="rounded bg-blue-500 px-2 py-1 text-[8px] text-white hover:bg-blue-600"
                                >
                                  设置模式
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div className="text-[9px] text-gray-600">
                              使用方式: <span className={`font-semibold ${isCodingPlan ? 'text-orange-600' : 'text-green-600'}`}>
                                {config ? MODEL_USAGE_MODE_LABELS[config.usageMode] : '按量模式（默认）'}
                              </span>
                            </div>
                            <div className="text-[9px] text-gray-600">
                              Token: 输入{formatNumber(data.inputTokens)} / 输出{formatNumber(data.outputTokens)}
                            </div>
                          </div>

                          {isCodingPlan && (
                            <div className="mt-2 rounded border border-orange-200 bg-orange-50 p-2">
                              <div className="mb-2 text-[9px] font-semibold text-orange-700">请求次数统计 (CodingPlan)</div>
                              <div className="space-y-1">
                                {(Object.keys(REQUEST_LIMIT_LABELS) as RequestLimitPeriod[]).map(period => {
                                  const stat = requestStats.find(s =>
                                    s.period === period &&
                                    s.provider === provider.provider &&
                                    s.model === model
                                  )
                                  return (
                                    <div key={period} className="flex items-center justify-between text-[8px]">
                                      <span className="text-gray-600">{REQUEST_LIMIT_LABELS[period]}:</span>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{stat?.requestCount || 0} 次</span>
                                        {limit && limit[period] > 0 && (
                                          <>
                                            <span className="text-gray-400">/</span>
                                            <span>{limit[period]} 次</span>
                                            <div className="ml-2 h-2 w-16 rounded-full bg-gray-200">
                                              <div
                                                className={`h-2 rounded-full ${(stat?.usagePercent || 0) > 90 ? 'bg-red-500' : (stat?.usagePercent || 0) > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                                style={{ width: `${Math.min(stat?.usagePercent || 0, 100)}%` }}
                                              />
                                            </div>
                                            <span className={`font-semibold ${(stat?.usagePercent || 0) > 90 ? 'text-red-600' : (stat?.usagePercent || 0) > 70 ? 'text-yellow-600' : 'text-green-600'}`}>
                                              {(stat?.usagePercent || 0).toFixed(1)}%
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>

                              {editingLimit?.provider === provider.provider && editingLimit?.model === model ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {(Object.keys(REQUEST_LIMIT_LABELS) as RequestLimitPeriod[]).map(period => (
                                    <div key={period} className="flex items-center gap-1">
                                      <label className="text-[8px] text-gray-600">{REQUEST_LIMIT_LABELS[period]}:</label>
                                      <input
                                        type="number"
                                        min="0"
                                        value={editLimits[period]}
                                        onChange={(e) => setEditLimits(prev => ({ ...prev, [period]: Number(e.target.value) }))}
                                        className="w-16 rounded border border-gray-300 px-1 py-0.5 text-[8px]"
                                        placeholder="额度"
                                      />
                                    </div>
                                  ))}
                                  <button
                                    onClick={handleSaveLimit}
                                    className="rounded bg-green-500 px-2 py-0.5 text-[8px] text-white hover:bg-green-600"
                                  >
                                    保存额度
                                  </button>
                                  <button
                                    onClick={() => setEditingLimit(null)}
                                    className="rounded bg-gray-400 px-2 py-0.5 text-[8px] text-white hover:bg-gray-500"
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleEditLimit(provider.provider, model)}
                                  className="mt-2 rounded bg-purple-500 px-2 py-0.5 text-[8px] text-white hover:bg-purple-600"
                                >
                                  设置请求额度
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        {/* Token bar chart */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 text-[11px] font-semibold text-blue-800">Token 用量分布</div>
          {barChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#BFDBFE" />
                <XAxis dataKey="name" tick={{ fill: '#1E40AF', fontSize: 10 }} />
                <YAxis tick={{ fill: '#1E40AF', fontSize: 10 }} tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#1E40AF' }}
                  formatter={(value: any) => formatNumber(value as number)}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#1E40AF' }} />
                <Bar dataKey="输入Token" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="输出Token" fill="#06B6D4" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[11px] text-blue-400">暂无数据</div>
          )}
        </div>

        {/* Cost curve chart */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 text-[11px] font-semibold text-blue-800">金额趋势</div>
          {costCurveData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={costCurveData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#BFDBFE" />
                <XAxis dataKey="date" tick={{ fill: '#1E40AF', fontSize: 10 }} />
                <YAxis tick={{ fill: '#1E40AF', fontSize: 10 }} tickFormatter={(v: number) => `¥${v}`} />
                <Tooltip
                  contentStyle={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#1E40AF' }}
                  formatter={(value: any) => `¥${(value as number).toFixed(4)}`}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#1E40AF' }} />
                <Area type="monotone" dataKey="累计费用" stroke="#10B981" fill="url(#costGrad)" strokeWidth={2} />
                <Line type="monotone" dataKey="当日费用" stroke="#F59E0B" strokeWidth={1.5} dot={{ r: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[11px] text-blue-400">暂无数据</div>
          )}
        </div>
      </div>

      {/* Provider detail table */}
      <div className="rounded-lg border border-blue-200 bg-blue-50">
        <div className="flex items-center justify-between border-b border-blue-200 px-4 py-2.5">
          <div className="text-[11px] font-semibold text-blue-800">提供商详细用量</div>
          <div className="flex items-center gap-2">
            <button onClick={clearRecords}
              className="rounded px-2 py-0.5 text-[9px] text-red-500 hover:bg-red-50 transition-colors">
              清除数据
            </button>
          </div>
        </div>

        {providerData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-blue-200 text-blue-600">
                  <th className="px-3 py-2 text-left font-medium">提供商</th>
                  <th className="px-3 py-2 text-right font-medium">输入Token</th>
                  <th className="px-3 py-2 text-right font-medium">输出Token</th>
                  <th className="px-3 py-2 text-right font-medium">缓存读取</th>
                  <th className="px-3 py-2 text-right font-medium">缓存创建</th>
                  <th className="px-3 py-2 text-right font-medium">总Token</th>
                  <th className="px-3 py-2 text-right font-medium">输入单价</th>
                  <th className="px-3 py-2 text-right font-medium">输出单价</th>
                  <th className="px-3 py-2 text-right font-medium">输入费用</th>
                  <th className="px-3 py-2 text-right font-medium">输出费用</th>
                  <th className="px-3 py-2 text-right font-medium">缓存费用</th>
                  <th className="px-3 py-2 text-right font-medium">总费用</th>
                  <th className="px-3 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {providerData.map((p, i) => {
                  const pPricing = pricing.find(pr => pr.provider === p.provider)
                  const isEditing = editingProvider === p.provider
                  return (
                    <tr key={p.provider} className="border-b border-blue-100 hover:bg-blue-100/50 transition-colors">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-blue-900 font-medium">{p.provider}</span>
                          {pPricing?.manualOverride && (
                            <span className="rounded bg-orange-100 px-1 py-0 text-[8px] text-orange-600">手动</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatNumber(p.inputTokens)}</td>
                      <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatNumber(p.outputTokens)}</td>
                      <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatNumber(p.cacheReadTokens)}</td>
                      <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatNumber(p.cacheCreationTokens)}</td>
                      <td className="px-3 py-2 text-right text-blue-600 font-mono font-medium">{formatNumber(p.totalTokens)}</td>
                      {isEditing ? (
                        <>
                          <td className="px-1 py-1"><input type="number" step="0.01" value={editPrices.input} onChange={e => setEditPrices(prev => ({ ...prev, input: +e.target.value }))} className="w-16 rounded border border-blue-300 bg-white px-1 py-0.5 text-[10px] text-right text-blue-900 outline-none" /></td>
                          <td className="px-1 py-1"><input type="number" step="0.01" value={editPrices.output} onChange={e => setEditPrices(prev => ({ ...prev, output: +e.target.value }))} className="w-16 rounded border border-blue-300 bg-white px-1 py-0.5 text-[10px] text-right text-blue-900 outline-none" /></td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right text-blue-600 font-mono">{pPricing?.inputPricePerMillion?.toFixed(2) || '-'}</td>
                          <td className="px-3 py-2 text-right text-blue-600 font-mono">{pPricing?.outputPricePerMillion?.toFixed(2) || '-'}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatCost(p.inputCost)}</td>
                      <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatCost(p.outputCost)}</td>
                      <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatCost(p.cacheReadCost + p.cacheCreationCost)}</td>
                      <td className="px-3 py-2 text-right text-blue-600 font-mono font-medium">{formatCost(p.totalCost)}</td>
                      <td className="px-3 py-2 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={handleSavePricing} className="rounded bg-green-500 px-1.5 py-0.5 text-[9px] text-white hover:bg-green-600">保存</button>
                            <button onClick={() => setEditingProvider(null)} className="rounded bg-gray-400 px-1.5 py-0.5 text-[9px] text-white hover:bg-gray-500">取消</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleEditProvider(p.provider)} className="rounded bg-blue-500 px-1.5 py-0.5 text-[9px] text-white hover:bg-blue-600">编辑</button>
                            {pPricing?.manualOverride && (
                              <button onClick={() => handleResetPricing(p.provider)} className="rounded bg-orange-400 px-1.5 py-0.5 text-[9px] text-white hover:bg-orange-500">重置</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-blue-100 font-medium">
                  <td className="px-3 py-2 text-blue-900">合计</td>
                  <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatNumber(providerData.reduce((s, p) => s + p.inputTokens, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatNumber(providerData.reduce((s, p) => s + p.outputTokens, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatNumber(providerData.reduce((s, p) => s + p.cacheReadTokens, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatNumber(providerData.reduce((s, p) => s + p.cacheCreationTokens, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatNumber(summary.totalTokens)}</td>
                  <td className="px-3 py-2" colSpan={2}></td>
                  <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatCost(providerData.reduce((s, p) => s + p.inputCost, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-800 font-mono">{formatCost(providerData.reduce((s, p) => s + p.outputCost, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatCost(providerData.reduce((s, p) => s + p.cacheReadCost + p.cacheCreationCost, 0))}</td>
                  <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatCost(summary.totalCost)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-[11px] text-blue-500">
            <div className="text-2xl mb-2">📊</div>
            <p>{periodLabel[period]}暂无 Token 使用记录</p>
            <p className="mt-1 text-[10px] text-blue-400">开始对话后，Token 使用数据将自动记录</p>
          </div>
        )}
      </div>

      {/* Pricing reference */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="mb-3 text-[11px] font-semibold text-blue-800">提供商单价参考 (元/百万Token)</div>
        <div className="grid grid-cols-2 gap-2">
          {pricing.map((p, i) => (
            <div key={p.provider} className="flex items-center gap-2 rounded border border-blue-200 bg-white px-3 py-2">
              <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="text-[10px] text-blue-900 font-medium w-20">{p.provider}</span>
              <div className="flex-1 text-[9px] text-blue-600 space-y-0.5">
                <div>输入: <span className="text-blue-900">{p.inputPricePerMillion.toFixed(2)}</span> / 输出: <span className="text-blue-900">{p.outputPricePerMillion.toFixed(2)}</span></div>
                <div>缓存读: <span className="text-blue-700">{p.cacheReadPricePerMillion.toFixed(2)}</span> / 缓存写: <span className="text-blue-700">{p.cacheCreationPricePerMillion.toFixed(2)}</span></div>
              </div>
              {p.manualOverride && <span className="shrink-0 rounded bg-orange-100 px-1 py-0 text-[8px] text-orange-600">手动</span>}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] text-blue-500">单价可在上方表格中点击"编辑"手动修改，点击"重置"恢复默认值</p>
      </div>
    </div>
  )
}

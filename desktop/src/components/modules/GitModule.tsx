import { useState, useCallback, useEffect, useRef } from 'react'

type Props = {
  workDir?: string
}

type GitSubTab = 'status' | 'log' | 'branches' | 'diff' | 'stash'

interface GitFile {
  status: string
  path: string
}

interface GitLogEntry {
  hash: string
  author: string
  date: string
  message: string
}

interface GitBranch {
  name: string
  current: boolean
}

async function execGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { Command } = await import('@tauri-apps/plugin-shell')
    const command = Command.create('git', args, { cwd: cwd || undefined })
    const output = await command.execute()
    if (output.code !== 0 && output.stderr) {
      throw new Error(output.stderr)
    }
    return output.stdout || output.stderr || ''
  } catch (err: any) {
    if (err?.message?.includes('not allowed') || err?.message?.includes('permission')) {
      throw new Error('Git 命令权限未配置，请在 Tauri 权限中添加 git 命令支持')
    }
    throw err
  }
}

function parseGitStatus(raw: string): GitFile[] {
  const files: GitFile[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const statusCode = trimmed.substring(0, 2).trim()
    const filePath = trimmed.substring(3).trim()
    if (filePath) {
      files.push({ status: statusCode, path: filePath })
    }
  }
  return files
}

function parseGitLog(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  const lines = raw.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split('|')
    if (parts.length >= 4) {
      entries.push({
        hash: parts[0]?.trim() || '',
        author: parts[1]?.trim() || '',
        date: parts[2]?.trim() || '',
        message: parts.slice(3).join('|').trim(),
      })
    }
  }
  return entries
}

function parseGitBranches(raw: string): GitBranch[] {
  const branches: GitBranch[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const current = trimmed.startsWith('*')
    const name = trimmed.replace(/^\* /, '').trim()
    branches.push({ name, current })
  }
  return branches
}

function statusToLabel(status: string): { text: string; color: string } {
  if (status.includes('??')) return { text: '未跟踪', color: 'text-gray-400' }
  if (status.includes('M') || status.includes('AM') || status.includes('MM')) return { text: '已修改', color: 'text-yellow-400' }
  if (status.includes('A')) return { text: '已添加', color: 'text-green-400' }
  if (status.includes('D')) return { text: '已删除', color: 'text-red-400' }
  if (status.includes('R')) return { text: '已重命名', color: 'text-blue-400' }
  if (status.includes('C')) return { text: '已复制', color: 'text-blue-400' }
  return { text: status, color: 'text-gray-400' }
}

export function GitModule({ workDir }: Props) {
  const [subTab, setSubTab] = useState<GitSubTab>('status')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [branch, setBranch] = useState('')
  const [repoName, setRepoName] = useState('')

  const [statusFiles, setStatusFiles] = useState<GitFile[]>([])
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [diffContent, setDiffContent] = useState('')
  const [stashList, setStashList] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>()

  const refreshAll = useCallback(async () => {
    if (!workDir) return
    setLoading(true)
    setError('')
    try {
      const [branchOut, statusOut] = await Promise.all([
        execGit(['rev-parse', '--abbrev-ref', 'HEAD'], workDir),
        execGit(['status', '--porcelain'], workDir),
      ])
      setBranch(branchOut.trim())

      try {
        const remoteOut = await execGit(['remote', 'get-url', 'origin'], workDir)
        const match = remoteOut.match(/\/([^/]+?)(\.git)?$/)
        setRepoName(match?.[1] || '')
      } catch { setRepoName('') }

      setStatusFiles(parseGitStatus(statusOut))

      if (subTab === 'log' || subTab === 'status') {
        try {
          const logOut = await execGit(['log', '--pretty=format:%h|%an|%ar|%s', '-20'], workDir)
          setLogEntries(parseGitLog(logOut))
        } catch { setLogEntries([]) }
      }

      if (subTab === 'branches') {
        try {
          const branchOut2 = await execGit(['branch', '-a'], workDir)
          setBranches(parseGitBranches(branchOut2))
        } catch { setBranches([]) }
      }

      if (subTab === 'diff') {
        try {
          const diffOut = selectedFile
            ? await execGit(['diff', selectedFile], workDir)
            : await execGit(['diff', '--stat'], workDir)
          setDiffContent(diffOut)
        } catch { setDiffContent('') }
      }

      if (subTab === 'stash') {
        try {
          const stashOut = await execGit(['stash', 'list'], workDir)
          setStashList(stashOut)
        } catch { setStashList('') }
      }
    } catch (err: any) {
      setError(err?.message || 'Git 操作失败')
    } finally {
      setLoading(false)
    }
  }, [workDir, subTab, selectedFile])

  useEffect(() => {
    refreshAll()
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }
  }, [refreshAll])

  const handleCommit = useCallback(async () => {
    if (!workDir || !commitMessage.trim()) return
    try {
      await execGit(['add', '-A'], workDir)
      await execGit(['commit', '-m', commitMessage.trim()], workDir)
      setCommitMessage('')
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '提交失败')
    }
  }, [workDir, commitMessage, refreshAll])

  const handlePull = useCallback(async () => {
    if (!workDir) return
    setLoading(true)
    try {
      await execGit(['pull'], workDir)
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '拉取失败')
    }
  }, [workDir, refreshAll])

  const handlePush = useCallback(async () => {
    if (!workDir) return
    setLoading(true)
    try {
      await execGit(['push'], workDir)
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '推送失败')
    }
  }, [workDir, refreshAll])

  const handleCheckout = useCallback(async (branchName: string) => {
    if (!workDir) return
    setLoading(true)
    try {
      await execGit(['checkout', branchName], workDir)
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '切换分支失败')
    }
  }, [workDir, refreshAll])

  const handleCreateBranch = useCallback(async () => {
    if (!workDir || !newBranchName.trim()) return
    setLoading(true)
    try {
      await execGit(['checkout', '-b', newBranchName.trim()], workDir)
      setNewBranchName('')
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '创建分支失败')
    }
  }, [workDir, newBranchName, refreshAll])

  const handleStash = useCallback(async () => {
    if (!workDir) return
    try {
      await execGit(['stash'], workDir)
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '暂存失败')
    }
  }, [workDir, refreshAll])

  const handleStashPop = useCallback(async () => {
    if (!workDir) return
    try {
      await execGit(['stash', 'pop'], workDir)
      refreshAll()
    } catch (err: any) {
      setError(err?.message || '恢复暂存失败')
    }
  }, [workDir, refreshAll])

  const handleFileDiff = useCallback(async (filePath: string) => {
    if (!workDir) return
    setSelectedFile(filePath)
    setSubTab('diff')
    try {
      const diffOut = await execGit(['diff', filePath], workDir)
      setDiffContent(diffOut)
    } catch (err: any) {
      setDiffContent(err?.message || '获取差异失败')
    }
  }, [workDir])

  const subTabs: Array<{ id: GitSubTab; label: string; icon: string }> = [
    { id: 'status', label: '状态', icon: '📋' },
    { id: 'log', label: '日志', icon: '📜' },
    { id: 'branches', label: '分支', icon: '🌿' },
    { id: 'diff', label: '差异', icon: '📊' },
    { id: 'stash', label: '暂存', icon: '📦' },
  ]

  if (!workDir) {
    return (
      <div className="flex h-full items-center justify-center bg-[#131128]">
        <div className="text-center">
          <span className="text-3xl">🔖</span>
          <p className="mt-2 text-[11px] text-gray-500">请先选择工作区目录以使用代码版本功能</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#0c0a18]">
      {/* Git header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#1e1850] to-[#211b45] px-3 py-1">
        <div className="flex items-center gap-1.5">
          <span>🔖</span>
          <span className="text-[11px] font-bold tracking-wider text-orange-300 uppercase">代码版本</span>
          {branch && (
            <span className="ml-1 rounded-full bg-orange-500/20 px-2 py-0.5 text-[9px] text-orange-400 font-medium">
              {repoName && <span className="mr-1">{repoName}</span>}
              🌿 {branch}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={handlePull} disabled={loading}
            className="flex h-5 items-center justify-center rounded bg-blue-700/50 px-2 text-[10px] text-white hover:bg-blue-600/60 disabled:opacity-30 transition-colors"
            title="拉取">⬇ 拉取</button>
          <button onClick={handlePush} disabled={loading}
            className="flex h-5 items-center justify-center rounded bg-blue-700/50 px-2 text-[10px] text-white hover:bg-blue-600/60 disabled:opacity-30 transition-colors"
            title="推送">⬆ 推送</button>
          <button onClick={refreshAll} disabled={loading}
            className="flex h-5 items-center justify-center rounded bg-indigo-600/50 px-2 text-[10px] text-white hover:bg-indigo-500/60 disabled:opacity-30 transition-colors"
            title="刷新">🔄</button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex shrink-0 items-center border-b border-[#231e42] bg-[#181532] px-1.5">
        {subTabs.map(tab => (
          <button key={tab.id} onClick={() => setSubTab(tab.id)}
            className={`relative shrink-0 rounded-t px-2.5 py-1 text-[10px] transition-colors ${
              subTab === tab.id ? 'bg-[#282350] text-white font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}>
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
            {tab.id === 'status' && statusFiles.length > 0 && (
              <span className="ml-1 rounded-full bg-red-500/30 px-1 py-0 text-[8px] text-red-300">{statusFiles.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Error bar */}
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-500/30 bg-red-900/20 px-3 py-1">
          <span className="text-[10px] text-red-400 flex-1 truncate">{error}</span>
          <button onClick={() => setError('')} className="text-[10px] text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="shrink-0 h-[2px] bg-indigo-500/50 overflow-hidden">
          <div className="h-full bg-indigo-400 animate-[loading_1.5s_ease-in-out_infinite]" style={{width: '40%'}} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* STATUS */}
        {subTab === 'status' && (
          <div className="p-3">
            {/* Quick commit */}
            <div className="mb-3 flex items-center gap-2">
              <input value={commitMessage} onChange={e => setCommitMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleCommit() }}
                className="h-7 flex-1 min-w-0 rounded border border-[#3a3466] bg-[#12101f] px-2.5 text-[11px] text-gray-300 outline-none"
                placeholder="提交信息 (Ctrl+Enter 提交)" />
              <button onClick={handleCommit} disabled={!commitMessage.trim()}
                className="flex h-7 items-center justify-center rounded bg-green-700/50 px-3 text-[10px] text-white hover:bg-green-600/60 disabled:opacity-30 transition-colors">
                提交
              </button>
            </div>

            {statusFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <span className="text-2xl">✅</span>
                <p className="mt-2 text-[11px] text-gray-500">工作区干净，没有未提交的更改</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
                  变更文件 ({statusFiles.length})
                </div>
                {statusFiles.map((file, i) => {
                  const label = statusToLabel(file.status)
                  return (
                    <div key={`${file.path}-${i}`}
                      onClick={() => handleFileDiff(file.path)}
                      className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white/5 transition-colors">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${label.color} bg-white/5`}>
                        {label.text}
                      </span>
                      <span className="truncate text-gray-300 group-hover:text-gray-100 flex-1">{file.path}</span>
                      <span className="shrink-0 text-[9px] text-gray-600 opacity-0 group-hover:opacity-100">查看差异 →</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Recent commits */}
            {logEntries.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
                  最近提交
                </div>
                {logEntries.slice(0, 5).map(entry => (
                  <div key={entry.hash} className="flex items-start gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white/5">
                    <span className="shrink-0 rounded bg-indigo-600/20 px-1.5 py-0.5 font-mono text-[9px] text-indigo-300">{entry.hash}</span>
                    <div className="flex-1 min-w-0">
                      <span className="truncate text-gray-300">{entry.message}</span>
                      <div className="text-[9px] text-gray-600 mt-0.5">{entry.author} · {entry.date}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LOG */}
        {subTab === 'log' && (
          <div className="p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-gray-500">
              提交历史 (最近 20 条)
            </div>
            {logEntries.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-gray-500">暂无提交记录</div>
            ) : (
              <div className="space-y-0.5">
                {logEntries.map(entry => (
                  <div key={entry.hash} className="flex items-start gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white/5">
                    <span className="shrink-0 rounded bg-indigo-600/20 px-1.5 py-0.5 font-mono text-[9px] text-indigo-300">{entry.hash}</span>
                    <div className="flex-1 min-w-0">
                      <span className="truncate text-gray-300">{entry.message}</span>
                      <div className="text-[9px] text-gray-600 mt-0.5">{entry.author} · {entry.date}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BRANCHES */}
        {subTab === 'branches' && (
          <div className="p-3">
            <div className="mb-3 flex items-center gap-2">
              <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch() }}
                className="h-7 flex-1 min-w-0 rounded border border-[#3a3466] bg-[#12101f] px-2.5 text-[11px] text-gray-300 outline-none"
                placeholder="新分支名称" />
              <button onClick={handleCreateBranch} disabled={!newBranchName.trim()}
                className="flex h-7 items-center justify-center rounded bg-green-700/50 px-3 text-[10px] text-white hover:bg-green-600/60 disabled:opacity-30 transition-colors">
                创建并切换
              </button>
            </div>

            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
              分支列表
            </div>
            {branches.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-gray-500">暂无分支信息</div>
            ) : (
              <div className="space-y-0.5">
                {branches.map((b, i) => (
                  <div key={`${b.name}-${i}`}
                    onClick={() => !b.current && handleCheckout(b.name.replace(/^remotes\/origin\//, ''))}
                    className={`group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors ${
                      b.current ? 'bg-orange-600/15 text-orange-200' : 'hover:bg-white/5 text-gray-400'
                    }`}>
                    <span className="shrink-0">{b.current ? '🌿' : '📎'}</span>
                    <span className="truncate flex-1">{b.name}</span>
                    {b.current && <span className="shrink-0 text-[9px] text-orange-400">当前</span>}
                    {!b.current && <span className="shrink-0 text-[9px] text-gray-600 opacity-0 group-hover:opacity-100">切换</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DIFF */}
        {subTab === 'diff' && (
          <div className="p-3">
            {selectedFile && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] text-gray-500">文件差异:</span>
                <span className="rounded bg-indigo-600/20 px-2 py-0.5 text-[10px] text-indigo-300">{selectedFile}</span>
                <button onClick={() => { setSelectedFile(''); setDiffContent('') }}
                  className="text-[10px] text-gray-500 hover:text-gray-300">清除</button>
              </div>
            )}
            {diffContent ? (
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-300 leading-relaxed overflow-x-auto">
                {diffContent.split('\n').map((line, i) => {
                  let lineColor = ''
                  if (line.startsWith('+++') || line.startsWith('@@')) lineColor = 'text-indigo-300'
                  else if (line.startsWith('---')) lineColor = 'text-red-300'
                  else if (line.startsWith('+') && !line.startsWith('++')) lineColor = 'text-green-400'
                  else if (line.startsWith('-') && !line.startsWith('--')) lineColor = 'text-red-400'
                  else if (line.startsWith('diff ') || line.startsWith('index ')) lineColor = 'text-gray-500'
                  return (
                    <div key={i} className={`${lineColor} hover:bg-white/3`}>
                      <span className="inline-block w-8 shrink-0 text-right mr-2 text-gray-600 select-none">{i + 1}</span>
                      {line}
                    </div>
                  )
                })}
              </pre>
            ) : (
              <div className="py-8 text-center text-[11px] text-gray-500">
                点击状态中的文件查看差异，或点击下方查看所有变更
                <div className="mt-2">
                  <button onClick={async () => {
                    if (!workDir) return
                    try {
                      const out = await execGit(['diff', '--stat'], workDir)
                      setDiffContent(out || '没有未暂存的更改')
                    } catch (err: any) { setDiffContent(err?.message || '获取差异失败') }
                  }} className="rounded bg-indigo-600/30 px-3 py-1 text-[10px] text-indigo-300 hover:bg-indigo-600/40 transition-colors">
                    查看所有变更统计
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STASH */}
        {subTab === 'stash' && (
          <div className="p-3">
            <div className="mb-3 flex items-center gap-2">
              <button onClick={handleStash}
                className="flex h-7 items-center justify-center rounded bg-yellow-700/50 px-3 text-[10px] text-white hover:bg-yellow-600/60 transition-colors">
                📦 暂存当前更改
              </button>
              <button onClick={handleStashPop}
                className="flex h-7 items-center justify-center rounded bg-green-700/50 px-3 text-[10px] text-white hover:bg-green-600/60 transition-colors">
                📤 恢复最近暂存
              </button>
            </div>

            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
              暂存列表
            </div>
            {stashList ? (
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-300 leading-relaxed">{stashList}</pre>
            ) : (
              <div className="py-8 text-center text-[11px] text-gray-500">暂无暂存记录</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

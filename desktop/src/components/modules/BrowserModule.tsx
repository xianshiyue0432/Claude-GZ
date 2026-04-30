import { useState, useCallback, useRef } from 'react'

type Props = {
  workDir?: string
}

export function BrowserModule({ workDir }: Props) {
  const [url, setUrl] = useState('https://www.bing.com')
  const [inputUrl, setInputUrl] = useState('https://www.bing.com')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>(['https://www.bing.com'])
  const [historyIndex, setHistoryIndex] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const navigateTo = useCallback((newUrl: string) => {
    let normalized = newUrl.trim()
    if (!normalized) return
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      if (normalized.includes('.') && !normalized.includes(' ')) {
        normalized = 'https://' + normalized
      } else {
        normalized = `https://www.bing.com/search?q=${encodeURIComponent(normalized)}`
      }
    }
    setUrl(normalized)
    setInputUrl(normalized)
    setLoading(true)
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(normalized)
      return newHistory
    })
    setHistoryIndex(prev => prev + 1)
  }, [historyIndex])

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      const prevUrl = history[newIndex]
      if (prevUrl) {
        setUrl(prevUrl)
        setInputUrl(prevUrl)
        setLoading(true)
      }
    }
  }, [historyIndex, history])

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      const nextUrl = history[newIndex]
      if (nextUrl) {
        setUrl(nextUrl)
        setInputUrl(nextUrl)
        setLoading(true)
      }
    }
  }, [historyIndex, history])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    if (iframeRef.current) {
      iframeRef.current.src = url
    }
  }, [url])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigateTo(inputUrl)
    }
  }, [inputUrl, navigateTo])

  const handleLoad = useCallback(() => {
    setLoading(false)
  }, [])

  return (
    <div className="flex h-full flex-col bg-[#0c0a18]">
      {/* Browser toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[#231e42] bg-[#181532] px-2 py-1.5">
        <button onClick={handleBack} disabled={historyIndex <= 0}
          className="flex h-6 w-6 items-center justify-center rounded text-[12px] text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-default transition-colors"
          title="后退">&#9664;</button>
        <button onClick={handleForward} disabled={historyIndex >= history.length - 1}
          className="flex h-6 w-6 items-center justify-center rounded text-[12px] text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-default transition-colors"
          title="前进">&#9654;</button>
        <button onClick={handleRefresh}
          className="flex h-6 w-6 items-center justify-center rounded text-[12px] text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          title="刷新">&#8635;</button>

        {/* URL bar */}
        <div className="relative flex flex-1 items-center">
          {loading && (
            <div className="absolute top-0 left-0 h-[2px] bg-indigo-500 animate-pulse" style={{width: '60%'}} />
          )}
          <div className="flex h-7 w-full items-center rounded border border-[#3a3466] bg-[#12101f] px-2.5">
            <span className="shrink-0 text-[10px] text-gray-500 mr-1.5">
              {url.startsWith('https') ? '🔒' : '⚠️'}
            </span>
            <input
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-300 outline-none"
              placeholder="输入网址或搜索内容..."
            />
          </div>
        </div>

        <button onClick={() => navigateTo('https://www.bing.com')}
          className="flex h-6 items-center justify-center rounded px-2 text-[10px] text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          title="主页">🏠</button>
      </div>

      {/* Bookmarks bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#231e42] bg-[#131128] px-2 py-1">
        {[
          { name: 'Bing', url: 'https://www.bing.com' },
          { name: 'Google', url: 'https://www.google.com' },
          { name: 'GitHub', url: 'https://github.com' },
          { name: 'MDN', url: 'https://developer.mozilla.org' },
          { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
        ].map(bm => (
          <button key={bm.url} onClick={() => navigateTo(bm.url)}
            className="rounded px-2 py-0.5 text-[10px] text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors">
            {bm.name}
          </button>
        ))}
      </div>

      {/* Browser content */}
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute top-0 left-0 right-0 z-10 h-[2px] bg-indigo-500/50 overflow-hidden">
            <div className="h-full bg-indigo-400 animate-[loading_1.5s_ease-in-out_infinite]" style={{width: '40%'}} />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={handleLoad}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          title="浏览器预览"
        />
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 items-center justify-between border-t border-[#231e42] bg-[#0d0b1a] px-3 py-0.5">
        <span className="text-[9px] text-gray-600 truncate max-w-[60%]">{loading ? '加载中...' : url}</span>
        <span className="text-[9px] text-gray-600">{workDir || ''}</span>
      </div>
    </div>
  )
}

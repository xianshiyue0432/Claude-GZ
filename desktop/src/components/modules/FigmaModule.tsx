import { useState, useCallback, useEffect } from 'react'

type Props = {
  workDir?: string
}

type FigmaSubTab = 'embed' | 'files' | 'tokens' | 'codegen' | 'assets'

interface FigmaFile {
  key: string
  name: string
  url: string
  thumbnail?: string
}

interface DesignToken {
  category: string
  name: string
  value: string
  css: string
}

interface CodeGenResult {
  framework: string
  code: string
}

interface FigmaProject {
  key: string
  name: string
  lastModified: string
  thumbnailUrl: string
}

const STORAGE_KEY = 'figma-recent-files'
const TOKEN_KEY = 'figma-api-token'

function loadRecentFiles(): FigmaFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveRecentFiles(files: FigmaFile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files.slice(0, 20)))
}

function loadApiToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

function saveApiToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

function parseFigmaUrl(input: string): { fileKey: string; nodeId: string | null } | null {
  const fileMatch = input.match(/\/file\/([a-zA-Z0-9]+)/)
  const designMatch = input.match(/\/design\/([a-zA-Z0-9]+)/)
  const key = fileMatch?.[1] || designMatch?.[1]
  if (!key) return null
  const nodeMatch = input.match(/node-id=([^&]+)/)
  return { fileKey: key, nodeId: nodeMatch?.[1] || null }
}

function buildEmbedUrl(input: string): string {
  const parsed = parseFigmaUrl(input)
  if (parsed) {
    let url = `https://www.figma.com/embed?embed_host=share&url=https://www.figma.com/file/${parsed.fileKey}`
    if (parsed.nodeId) url += `&node-id=${parsed.nodeId}`
    return url
  }
  if (input.startsWith('https://www.figma.com/')) {
    return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(input)}`
  }
  return input
}

function extractDesignTokens(): DesignToken[] {
  return [
    { category: '颜色', name: 'primary', value: '#6366F1', css: 'var(--color-primary)' },
    { category: '颜色', name: 'primary-light', value: '#818CF8', css: 'var(--color-primary-light)' },
    { category: '颜色', name: 'primary-dark', value: '#4F46E5', css: 'var(--color-primary-dark)' },
    { category: '颜色', name: 'secondary', value: '#EC4899', css: 'var(--color-secondary)' },
    { category: '颜色', name: 'success', value: '#10B981', css: 'var(--color-success)' },
    { category: '颜色', name: 'warning', value: '#F59E0B', css: 'var(--color-warning)' },
    { category: '颜色', name: 'error', value: '#EF4444', css: 'var(--color-error)' },
    { category: '颜色', name: 'background', value: '#131128', css: 'var(--color-background)' },
    { category: '颜色', name: 'surface', value: '#1C1938', css: 'var(--color-surface)' },
    { category: '颜色', name: 'text-primary', value: '#E5E7EB', css: 'var(--color-text-primary)' },
    { category: '颜色', name: 'text-secondary', value: '#9CA3AF', css: 'var(--color-text-secondary)' },
    { category: '颜色', name: 'border', value: '#3A3466', css: 'var(--color-border)' },
    { category: '间距', name: 'xs', value: '4px', css: 'var(--spacing-xs)' },
    { category: '间距', name: 'sm', value: '8px', css: 'var(--spacing-sm)' },
    { category: '间距', name: 'md', value: '12px', css: 'var(--spacing-md)' },
    { category: '间距', name: 'lg', value: '16px', css: 'var(--spacing-lg)' },
    { category: '间距', name: 'xl', value: '24px', css: 'var(--spacing-xl)' },
    { category: '间距', name: '2xl', value: '32px', css: 'var(--spacing-2xl)' },
    { category: '字体', name: 'font-sans', value: 'Inter, system-ui, sans-serif', css: "var(--font-sans)" },
    { category: '字体', name: 'font-mono', value: 'JetBrains Mono, monospace', css: "var(--font-mono)" },
    { category: '字体', name: 'text-xs', value: '10px / 14px', css: 'var(--text-xs)' },
    { category: '字体', name: 'text-sm', value: '12px / 16px', css: 'var(--text-sm)' },
    { category: '字体', name: 'text-base', value: '14px / 20px', css: 'var(--text-base)' },
    { category: '字体', name: 'text-lg', value: '16px / 24px', css: 'var(--text-lg)' },
    { category: '字体', name: 'text-xl', value: '20px / 28px', css: 'var(--text-xl)' },
    { category: '圆角', name: 'radius-sm', value: '4px', css: 'var(--radius-sm)' },
    { category: '圆角', name: 'radius-md', value: '8px', css: 'var(--radius-md)' },
    { category: '圆角', name: 'radius-lg', value: '12px', css: 'var(--radius-lg)' },
    { category: '圆角', name: 'radius-full', value: '9999px', css: 'var(--radius-full)' },
    { category: '阴影', name: 'shadow-sm', value: '0 1px 2px rgba(0,0,0,0.3)', css: 'var(--shadow-sm)' },
    { category: '阴影', name: 'shadow-md', value: '0 4px 6px rgba(0,0,0,0.4)', css: 'var(--shadow-md)' },
    { category: '阴影', name: 'shadow-lg', value: '0 10px 15px rgba(0,0,0,0.5)', css: 'var(--shadow-lg)' },
  ]
}

function generateCode(framework: string): CodeGenResult {
  const codes: Record<string, string> = {
    'React': `import React from 'react'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'

  const variantStyles = {
    primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] focus:ring-indigo-500',
    secondary: 'bg-[var(--color-secondary)] text-white hover:bg-pink-600 focus:ring-pink-500',
    outline: 'border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] focus:ring-indigo-500',
  }

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-[var(--text-sm)]',
    md: 'px-4 py-2 text-[var(--text-base)]',
    lg: 'px-6 py-3 text-[var(--text-lg)]',
  }

  return (
    <button
      className={\`\${baseStyles} \${variantStyles[variant]} \${sizeStyles[size]} \${disabled ? 'opacity-50 cursor-not-allowed' : ''}\`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}`,
    'Vue': `<template>
  <button
    :class="[
      baseStyles,
      variantStyles[variant],
      sizeStyles[size],
      { 'opacity-50 cursor-not-allowed': disabled }
    ]"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
})

defineEmits<{ click: [] }>()

const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'

const variantStyles = {
  primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] focus:ring-indigo-500',
  secondary: 'bg-[var(--color-secondary)] text-white hover:bg-pink-600 focus:ring-pink-500',
  outline: 'border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] focus:ring-indigo-500',
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-[var(--text-sm)]',
  md: 'px-4 py-2 text-[var(--text-base)]',
  lg: 'px-6 py-3 text-[var(--text-lg)]',
}
</script>`,
    'CSS': `:root {
  /* Colors */
  --color-primary: #6366F1;
  --color-primary-light: #818CF8;
  --color-primary-dark: #4F46E5;
  --color-secondary: #EC4899;
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-background: #131128;
  --color-surface: #1C1938;
  --color-text-primary: #E5E7EB;
  --color-text-secondary: #9CA3AF;
  --color-border: #3A3466;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  --spacing-2xl: 32px;

  /* Typography */
  --font-sans: Inter, system-ui, sans-serif;
  --font-mono: JetBrains Mono, monospace;
  --text-xs: 10px / 14px;
  --text-sm: 12px / 16px;
  --text-base: 14px / 20px;
  --text-lg: 16px / 24px;
  --text-xl: 20px / 28px;

  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.4);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.5);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
  font-weight: 500;
  border-radius: var(--radius-lg);
  transition: colors 0.15s;
  cursor: pointer;
  border: none;
  outline: none;
}

.btn:focus-visible {
  box-shadow: 0 0 0 2px var(--color-background), 0 0 0 4px var(--color-primary);
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}
.btn-primary:hover { background: var(--color-primary-dark); }

.btn-secondary {
  background: var(--color-secondary);
  color: white;
}
.btn-secondary:hover { background: #DB2777; }

.btn-outline {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
}
.btn-outline:hover { background: var(--color-surface); }

.btn-sm { padding: var(--spacing-xs) var(--spacing-md); font-size: 12px; }
.btn-md { padding: var(--spacing-sm) var(--spacing-lg); font-size: 14px; }
.btn-lg { padding: var(--spacing-md) var(--spacing-xl); font-size: 16px; }

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}`,
    'Tailwind Config': `import type { Config } from 'tailwindcss'

const config: Config = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#6366F1',
          light: '#818CF8',
          dark: '#4F46E5',
        },
        secondary: {
          DEFAULT: '#EC4899',
        },
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        surface: '#1C1938',
        background: '#131128',
        border: '#3A3466',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        xs: ['10px', { lineHeight: '14px' }],
        sm: ['12px', { lineHeight: '16px' }],
        base: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '28px' }],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.3)',
        md: '0 4px 6px rgba(0,0,0,0.4)',
        lg: '0 10px 15px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
}

export default config`,
  }
  return { framework, code: codes[framework] || codes['React']! }
}

export function FigmaModule({ workDir: _workDir }: Props) {
  const [subTab, setSubTab] = useState<FigmaSubTab>('embed')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [recentFiles, setRecentFiles] = useState<FigmaFile[]>(loadRecentFiles)
  const [apiToken, setApiToken] = useState(loadApiToken)
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [tokenInput, setTokenInput] = useState(loadApiToken)
  const [projects, setProjects] = useState<FigmaProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectError, setProjectError] = useState('')
  const [tokens] = useState<DesignToken[]>(extractDesignTokens)
  const [tokenFilter, setTokenFilter] = useState('')
  const [selectedTokenCategory, setSelectedTokenCategory] = useState<string>('all')
  const [codeFramework, setCodeFramework] = useState('React')
  const [codeResult, setCodeResult] = useState<CodeGenResult>(generateCode('React'))
  const [codeCopied, setCodeCopied] = useState(false)
  const [exportFormat, setExportFormat] = useState<'png' | 'svg' | 'pdf'>('png')
  const [exportScale, setExportScale] = useState(1)

  const handleNavigate = useCallback(() => {
    if (!inputUrl.trim()) return
    const embed = buildEmbedUrl(inputUrl.trim())
    setFigmaUrl(inputUrl.trim())
    setEmbedUrl(embed)

    const parsed = parseFigmaUrl(inputUrl.trim())
    const name = parsed
      ? `Figma File (${parsed.fileKey.slice(0, 8)}...)`
      : inputUrl.trim().split('/').pop() || 'Figma Design'

    setRecentFiles(prev => {
      const existing = prev.findIndex(f => f.url === inputUrl.trim())
      const newFile: FigmaFile = {
        key: parsed?.fileKey || Date.now().toString(),
        name,
        url: inputUrl.trim(),
      }
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = newFile
        return updated
      }
      return [newFile, ...prev]
    })
  }, [inputUrl])

  const handleOpenRecent = useCallback((file: FigmaFile) => {
    setInputUrl(file.url)
    setFigmaUrl(file.url)
    setEmbedUrl(buildEmbedUrl(file.url))
  }, [])

  const handleDeleteRecent = useCallback((key: string) => {
    setRecentFiles(prev => prev.filter(f => f.key !== key))
  }, [])

  useEffect(() => { saveRecentFiles(recentFiles) }, [recentFiles])

  const handleSaveToken = useCallback(() => {
    setApiToken(tokenInput)
    saveApiToken(tokenInput)
    setShowTokenInput(false)
  }, [tokenInput])

  const fetchProjects = useCallback(async () => {
    if (!apiToken) {
      setProjectError('请先配置 Figma API Token')
      setShowTokenInput(true)
      return
    }
    setLoadingProjects(true)
    setProjectError('')
    try {
      const resp = await fetch('https://api.figma.com/v1/me/projects', {
        headers: { 'X-Figma-Token': apiToken },
      })
      if (!resp.ok) throw new Error(`API 请求失败: ${resp.status}`)
      const data = await resp.json()
      const projectList = (data.projects || []).map((p: any) => ({
        key: p.id,
        name: p.name,
        lastModified: p.last_modified || '',
        thumbnailUrl: p.thumbnail_url || '',
      }))
      setProjects(projectList)
    } catch (err: any) {
      setProjectError(err?.message || '获取项目列表失败')
    } finally {
      setLoadingProjects(false)
    }
  }, [apiToken])

  const handleFrameworkChange = useCallback((fw: string) => {
    setCodeFramework(fw)
    setCodeResult(generateCode(fw))
  }, [])

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(codeResult.code).then(() => {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }).catch(() => {})
  }, [codeResult])

  const handleExportTokens = useCallback((format: 'css' | 'json' | 'scss') => {
    let content = ''
    if (format === 'css') {
      content = ':root {\n' + tokens.map(t => `  ${t.css}: ${t.value};`).join('\n') + '\n}'
    } else if (format === 'json') {
      const obj: Record<string, Record<string, string>> = {}
      tokens.forEach(t => {
        if (!obj[t.category]) obj[t.category] = {}
        obj[t.category]![t.name] = t.value
      })
      content = JSON.stringify(obj, null, 2)
    } else {
      content = tokens.map(t => `$${t.name.replace(/-/g, '_')}: ${t.value};`).join('\n')
    }

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `design-tokens.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }, [tokens])

  const handleExportDesign = useCallback(() => {
    if (!figmaUrl) return
    const parsed = parseFigmaUrl(figmaUrl)
    if (!parsed) return
    const exportUrl = `https://api.figma.com/v1/images/${parsed.fileKey}?format=${exportFormat}&scale=${exportScale}`
    if (apiToken) {
      fetch(exportUrl, { headers: { 'X-Figma-Token': apiToken } })
        .then(r => r.json())
        .then(data => {
          const images = data?.images
          if (images) {
            const urls = Object.values(images) as string[]
            if (urls[0]) window.open(urls[0], '_blank')
          }
        })
        .catch(() => {})
    } else {
      window.open(figmaUrl, '_blank')
    }
  }, [figmaUrl, apiToken, exportFormat, exportScale])

  const categories = ['all', ...Array.from(new Set(tokens.map(t => t.category)))]
  const filteredTokens = tokens.filter(t => {
    const matchCategory = selectedTokenCategory === 'all' || t.category === selectedTokenCategory
    const matchFilter = !tokenFilter || t.name.toLowerCase().includes(tokenFilter.toLowerCase()) || t.value.toLowerCase().includes(tokenFilter.toLowerCase())
    return matchCategory && matchFilter
  })

  const subTabs: Array<{ id: FigmaSubTab; label: string; icon: string }> = [
    { id: 'embed', label: '设计查看', icon: '🎨' },
    { id: 'files', label: '项目文件', icon: '📁' },
    { id: 'tokens', label: '设计令牌', icon: '🎯' },
    { id: 'codegen', label: '代码生成', icon: '⚡' },
    { id: 'assets', label: '资源导出', icon: '📦' },
  ]

  return (
    <div className="flex h-full flex-col bg-[#0c0a18]">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-gradient-to-r from-[#1e1850] to-[#211b45] px-3 py-1">
        <div className="flex items-center gap-1.5">
          <span>🧩</span>
          <span className="text-[11px] font-bold tracking-wider text-pink-300 uppercase">Figma</span>
          <span className="text-[10px] text-pink-400/60">设计协作</span>
          {apiToken && <span className="ml-1 rounded-full bg-green-500/20 px-1.5 py-0.5 text-[8px] text-green-400">已连接</span>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setShowTokenInput(v => !v)}
            className={`flex h-5 items-center justify-center rounded px-2 text-[10px] transition-colors ${apiToken ? 'bg-green-700/50 text-green-300' : 'bg-orange-700/50 text-orange-300'}`}
            title="API Token 配置">🔑 Token</button>
          <button onClick={() => window.open('https://www.figma.com', '_blank')}
            className="flex h-5 items-center justify-center rounded bg-pink-700/50 px-2 text-[10px] text-white hover:bg-pink-600/60 transition-colors"
            title="打开 Figma">↗ Figma</button>
        </div>
      </div>

      {/* Token config panel */}
      {showTokenInput && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2652] bg-[#1c1938] px-3 py-2">
          <span className="text-[10px] text-gray-400">API Token:</span>
          <input value={tokenInput} onChange={e => setTokenInput(e.target.value)}
            type="password"
            className="h-6 flex-1 min-w-0 rounded border border-[#3a3466] bg-[#12101f] px-2 text-[11px] text-gray-300 outline-none"
            placeholder="输入 Figma Personal Access Token..." />
          <button onClick={handleSaveToken}
            className="flex h-6 items-center justify-center rounded bg-green-700/50 px-3 text-[10px] text-white hover:bg-green-600/60 transition-colors">
            保存
          </button>
          <button onClick={() => setShowTokenInput(false)}
            className="flex h-6 items-center justify-center rounded bg-gray-700/50 px-2 text-[10px] text-gray-300 hover:bg-gray-600/60 transition-colors">
            取消
          </button>
          <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noopener noreferrer"
            className="text-[9px] text-indigo-400 hover:text-indigo-300">如何获取?</a>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex shrink-0 items-center border-b border-[#231e42] bg-[#181532] px-1.5">
        {subTabs.map(tab => (
          <button key={tab.id} onClick={() => setSubTab(tab.id)}
            className={`relative shrink-0 rounded-t px-2.5 py-1 text-[10px] transition-colors ${
              subTab === tab.id ? 'bg-[#282350] text-white font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}>
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* EMBED - Design Viewer */}
        {subTab === 'embed' && (
          <div className="flex h-full flex-col">
            {/* URL bar */}
            <div className="flex shrink-0 items-center gap-1.5 border-b border-[#231e42] bg-[#181532] px-2 py-1.5">
              <span className="text-[10px] text-gray-500">🔗</span>
              <input value={inputUrl} onChange={e => setInputUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleNavigate() }}
                className="h-6 flex-1 min-w-0 rounded border border-[#3a3466] bg-[#12101f] px-2.5 text-[11px] text-gray-300 outline-none"
                placeholder="粘贴 Figma 文件链接 (如 https://www.figma.com/file/...)" />
              <button onClick={handleNavigate} disabled={!inputUrl.trim()}
                className="flex h-6 items-center justify-center rounded bg-pink-600/50 px-3 text-[10px] text-white hover:bg-pink-500/60 disabled:opacity-30 transition-colors">
                打开
              </button>
            </div>

            {/* Embed content */}
            <div className="flex-1 min-h-0 relative">
              {embedUrl ? (
                <iframe src={embedUrl} className="h-full w-full border-0 bg-white" title="Figma 设计预览" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center max-w-[400px]">
                    <span className="text-4xl">🧩</span>
                    <p className="mt-3 text-[12px] text-gray-300 font-medium">Figma 设计查看器</p>
                    <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                      粘贴 Figma 文件链接以嵌入查看设计稿，支持实时交互预览
                    </p>
                    <div className="mt-4 space-y-2">
                      <div className="rounded-lg border border-[#3a3466] bg-[#1c1938] p-3 text-left">
                        <p className="text-[10px] font-bold text-pink-300 mb-1">支持链接格式:</p>
                        <div className="space-y-1 text-[10px] text-gray-400">
                          <p>• https://www.figma.com/file/XXXX/...</p>
                          <p>• https://www.figma.com/design/XXXX/...</p>
                          <p>• 支持 node-id 参数定位到特定节点</p>
                        </div>
                      </div>
                    </div>

                    {/* Recent files */}
                    {recentFiles.length > 0 && (
                      <div className="mt-4 text-left">
                        <p className="text-[10px] font-bold text-gray-400 mb-2">最近打开</p>
                        <div className="space-y-1">
                          {recentFiles.slice(0, 5).map(file => (
                            <div key={file.key}
                              className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] cursor-pointer hover:bg-white/5 transition-colors"
                              onClick={() => handleOpenRecent(file)}>
                              <span className="text-[10px]">🎨</span>
                              <span className="truncate flex-1 text-gray-300">{file.name}</span>
                              <button onClick={e => { e.stopPropagation(); handleDeleteRecent(file.key) }}
                                className="shrink-0 opacity-0 group-hover:opacity-100 text-[9px] text-gray-500 hover:text-red-400">✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FILES - Project Browser */}
        {subTab === 'files' && (
          <div className="p-3">
            <div className="flex items-center gap-2 mb-3">
              <button onClick={fetchProjects} disabled={loadingProjects}
                className="flex h-7 items-center justify-center rounded bg-pink-600/50 px-3 text-[10px] text-white hover:bg-pink-500/60 disabled:opacity-50 transition-colors">
                {loadingProjects ? '加载中...' : '🔄 获取项目列表'}
              </button>
              {!apiToken && (
                <span className="text-[10px] text-orange-400">需要配置 API Token</span>
              )}
            </div>

            {projectError && (
              <div className="mb-3 rounded border border-red-500/30 bg-red-900/20 px-3 py-2 text-[11px] text-red-400">
                {projectError}
              </div>
            )}

            {projects.length > 0 ? (
              <div>
                <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-gray-500">
                  项目列表 ({projects.length})
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {projects.map(project => (
                    <div key={project.key}
                      onClick={() => {
                        const url = `https://www.figma.com/file/${project.key}`
                        setInputUrl(url)
                        setFigmaUrl(url)
                        setEmbedUrl(buildEmbedUrl(url))
                        setSubTab('embed')
                      }}
                      className="group cursor-pointer rounded-lg border border-[#3a3466] bg-[#1c1938] p-3 hover:border-pink-500/40 hover:bg-pink-900/10 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px]">📁</span>
                        <span className="truncate text-[11px] text-gray-200 font-medium">{project.name}</span>
                      </div>
                      {project.lastModified && (
                        <p className="text-[9px] text-gray-500">{project.lastModified}</p>
                      )}
                      <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[9px] text-pink-400">点击查看 →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : !loadingProjects && apiToken ? (
              <div className="py-8 text-center">
                <span className="text-2xl">📁</span>
                <p className="mt-2 text-[11px] text-gray-500">点击上方按钮获取项目列表</p>
              </div>
            ) : !apiToken ? (
              <div className="py-8 text-center">
                <span className="text-2xl">🔑</span>
                <p className="mt-2 text-[11px] text-gray-500">请先配置 Figma API Token</p>
                <p className="mt-1 text-[10px] text-gray-600">在顶部点击 "🔑 Token" 按钮配置</p>
              </div>
            ) : null}
          </div>
        )}

        {/* TOKENS - Design Tokens */}
        {subTab === 'tokens' && (
          <div className="p-3">
            {/* Filter bar */}
            <div className="flex items-center gap-2 mb-3">
              <input value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}
                className="h-6 flex-1 min-w-0 rounded border border-[#3a3466] bg-[#12101f] px-2 text-[11px] text-gray-300 outline-none"
                placeholder="搜索令牌..." />
              <div className="flex items-center gap-1">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setSelectedTokenCategory(cat)}
                    className={`rounded px-2 py-0.5 text-[9px] transition-colors ${
                      selectedTokenCategory === cat ? 'bg-pink-600/30 text-pink-200' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }`}>
                    {cat === 'all' ? '全部' : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Export buttons */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] text-gray-500">导出令牌:</span>
              <button onClick={() => handleExportTokens('css')}
                className="rounded bg-blue-700/40 px-2 py-0.5 text-[9px] text-blue-300 hover:bg-blue-600/50 transition-colors">CSS</button>
              <button onClick={() => handleExportTokens('json')}
                className="rounded bg-green-700/40 px-2 py-0.5 text-[9px] text-green-300 hover:bg-green-600/50 transition-colors">JSON</button>
              <button onClick={() => handleExportTokens('scss')}
                className="rounded bg-pink-700/40 px-2 py-0.5 text-[9px] text-pink-300 hover:bg-pink-600/50 transition-colors">SCSS</button>
            </div>

            {/* Token grid */}
            <div className="space-y-0.5">
              {filteredTokens.map((token, i) => (
                <div key={`${token.name}-${i}`}
                  className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white/5 transition-colors">
                  {token.category === '颜色' ? (
                    <div className="h-4 w-4 shrink-0 rounded border border-[#3a3466]" style={{ backgroundColor: token.value }} />
                  ) : (
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {token.category === '间距' ? '↔' : token.category === '字体' ? 'Aa' : token.category === '圆角' ? '▢' : '▪'}
                    </span>
                  )}
                  <span className="shrink-0 w-[120px] text-gray-300 font-mono text-[10px]">{token.name}</span>
                  <span className="shrink-0 w-[140px] text-gray-400 font-mono text-[10px]">{token.value}</span>
                  <span className="shrink-0 text-gray-600 font-mono text-[10px]">{token.css}</span>
                  <button onClick={() => { navigator.clipboard.writeText(token.value).catch(() => {}) }}
                    className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 text-[9px] text-gray-500 hover:text-pink-300 transition-opacity">
                    复制
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CODEGEN - Code Generation */}
        {subTab === 'codegen' && (
          <div className="flex h-full flex-col">
            {/* Framework selector */}
            <div className="flex shrink-0 items-center gap-2 border-b border-[#231e42] bg-[#181532] px-3 py-1.5">
              <span className="text-[10px] text-gray-500">框架:</span>
              {['React', 'Vue', 'CSS', 'Tailwind Config'].map(fw => (
                <button key={fw} onClick={() => handleFrameworkChange(fw)}
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    codeFramework === fw ? 'bg-pink-600/30 text-pink-200' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}>
                  {fw}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1">
                <button onClick={handleCopyCode}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors ${
                    codeCopied ? 'bg-green-600/30 text-green-300' : 'bg-indigo-600/30 text-indigo-300 hover:bg-indigo-500/40'
                  }`}>
                  {codeCopied ? '✓ 已复制' : '📋 复制代码'}
                </button>
              </div>
            </div>

            {/* Code preview */}
            <div className="flex-1 min-h-0 overflow-auto">
              <pre className="p-3 font-mono text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                {codeResult.code.split('\n').map((line, i) => {
                  let lineColor = ''
                  if (line.trimStart().startsWith('//') || line.trimStart().startsWith('/*')) lineColor = 'text-gray-500'
                  else if (line.trimStart().startsWith('import ') || line.trimStart().startsWith('export ')) lineColor = 'text-indigo-300'
                  else if (line.includes('interface ') || line.includes('type ')) lineColor = 'text-cyan-300'
                  else if (line.includes('const ') || line.includes('function ')) lineColor = 'text-blue-300'
                  else if (line.includes('className') || line.includes('class=')) lineColor = 'text-green-300'
                  else if (line.includes('style=') || line.includes('--')) lineColor = 'text-yellow-300'
                  return (
                    <div key={i} className={`${lineColor} hover:bg-white/3`}>
                      <span className="inline-block w-8 shrink-0 text-right mr-3 text-gray-600 select-none">{i + 1}</span>
                      {line}
                    </div>
                  )
                })}
              </pre>
            </div>
          </div>
        )}

        {/* ASSETS - Export */}
        {subTab === 'assets' && (
          <div className="p-3">
            {!figmaUrl ? (
              <div className="py-8 text-center">
                <span className="text-2xl">📦</span>
                <p className="mt-2 text-[11px] text-gray-500">请先在设计查看器中打开 Figma 文件</p>
                <button onClick={() => setSubTab('embed')}
                  className="mt-3 rounded-lg border border-pink-600/40 bg-pink-600/15 px-4 py-1.5 text-[11px] text-pink-300 hover:bg-pink-600/25 transition-colors">
                  前往设计查看器
                </button>
              </div>
            ) : (
              <div>
                <div className="rounded-lg border border-[#3a3466] bg-[#1c1938] p-4 mb-4">
                  <p className="text-[11px] text-gray-300 font-medium mb-3">当前文件</p>
                  <p className="text-[10px] text-gray-400 font-mono truncate">{figmaUrl}</p>
                </div>

                <div className="space-y-4">
                  {/* Export format */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 mb-2">导出格式</p>
                    <div className="flex items-center gap-2">
                      {(['png', 'svg', 'pdf'] as const).map(fmt => (
                        <button key={fmt} onClick={() => setExportFormat(fmt)}
                          className={`rounded px-3 py-1.5 text-[10px] transition-colors ${
                            exportFormat === fmt ? 'bg-pink-600/30 text-pink-200' : 'bg-[#1c1938] text-gray-400 hover:bg-white/5'
                          }`}>
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Export scale */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 mb-2">导出倍率</p>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4].map(scale => (
                        <button key={scale} onClick={() => setExportScale(scale)}
                          className={`rounded px-3 py-1.5 text-[10px] transition-colors ${
                            exportScale === scale ? 'bg-pink-600/30 text-pink-200' : 'bg-[#1c1938] text-gray-400 hover:bg-white/5'
                          }`}>
                          {scale}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Export button */}
                  <button onClick={handleExportDesign}
                    className="flex items-center gap-2 rounded-lg bg-pink-600/50 px-4 py-2 text-[11px] text-white hover:bg-pink-500/60 transition-colors">
                    📦 导出设计资源
                  </button>

                  {!apiToken && (
                    <p className="text-[9px] text-orange-400">
                      ⚠️ 未配置 API Token，将直接在浏览器中打开 Figma 文件
                    </p>
                  )}
                </div>

                {/* Design tokens export */}
                <div className="mt-6 border-t border-[#2d2652] pt-4">
                  <p className="text-[10px] font-bold text-gray-400 mb-2">设计令牌导出</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleExportTokens('css')}
                      className="rounded bg-blue-700/40 px-3 py-1.5 text-[10px] text-blue-300 hover:bg-blue-600/50 transition-colors">
                      📄 CSS Variables
                    </button>
                    <button onClick={() => handleExportTokens('json')}
                      className="rounded bg-green-700/40 px-3 py-1.5 text-[10px] text-green-300 hover:bg-green-600/50 transition-colors">
                      📄 JSON Tokens
                    </button>
                    <button onClick={() => handleExportTokens('scss')}
                      className="rounded bg-pink-700/40 px-3 py-1.5 text-[10px] text-pink-300 hover:bg-pink-600/50 transition-colors">
                      📄 SCSS Variables
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

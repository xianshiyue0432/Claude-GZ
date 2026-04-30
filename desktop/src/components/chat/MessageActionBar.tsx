import { useState } from 'react'
import { CopyButton } from '../shared/CopyButton'

type Props = {
  copyText?: string
  copyLabel: string
  onRewind?: () => void
  rewindLabel?: string
  onDelete?: () => void
  onBookmark?: () => void
  isBookmarked?: boolean
  onRetry?: () => void
  align?: 'start' | 'end'
}

export function MessageActionBar({
  copyText,
  copyLabel,
  onRewind,
  rewindLabel = '回滚到这里',
  onDelete,
  onBookmark,
  isBookmarked = false,
  onRetry,
  align = 'start',
}: Props) {
  const hasCopy = Boolean(copyText?.trim())
  const hasRewind = Boolean(onRewind)
  const hasDelete = Boolean(onDelete)
  const hasBookmark = Boolean(onBookmark)
  const hasRetry = Boolean(onRetry)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!hasCopy && !hasRewind && !hasDelete && !hasBookmark && !hasRetry) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`flex w-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {hasBookmark && (
          <button
            type="button"
            onClick={onBookmark}
            aria-label={isBookmarked ? '取消标记' : '标记'}
            title={isBookmarked ? '取消标记' : '标记'}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          >
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: isBookmarked ? '"FILL" 1' : '"FILL" 0' }}>
              bookmark
            </span>
            <span className="hidden min-[920px]:inline">{isBookmarked ? '已标记' : '标记'}</span>
          </button>
        )}
        {hasRetry && (
          <button
            type="button"
            onClick={onRetry}
            aria-label="重试"
            title="重试"
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
            <span className="hidden min-[920px]:inline">重试</span>
          </button>
        )}
        {hasRewind && (
          <button
            type="button"
            onClick={onRewind}
            aria-label={rewindLabel}
            title={rewindLabel}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          >
            <span className="material-symbols-outlined text-[14px]">undo</span>
            <span className="hidden min-[920px]:inline">回滚</span>
          </button>
        )}
        {hasCopy && (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            displayLabel="复制"
            displayCopiedLabel="已复制"
            className="inline-flex min-h-7 items-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          />
        )}
        {hasDelete && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="删除"
            title="删除"
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-red-400/50 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/35"
          >
            <span className="material-symbols-outlined text-[14px]">delete</span>
            <span className="hidden min-[920px]:inline">删除</span>
          </button>
        )}
        {hasDelete && confirmDelete && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { onDelete?.(); setConfirmDelete(false) }}
              className="inline-flex min-h-7 items-center gap-1 rounded-full border border-red-400/50 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20"
            >
              确认删除
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="inline-flex min-h-7 items-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

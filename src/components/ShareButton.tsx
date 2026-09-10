import { useEffect, useState } from 'react'
import type { Analytics } from '../analytics/analytics'
import { share, type ShareResult } from '../share/share'
import type { SharePayload } from '../share/text'

interface Props {
  payload: SharePayload
  analytics: Analytics
  className?: string
  testId?: string
  /** Idle label; "Share" on the game-over panel, "Share Score" on the home screen. */
  label?: string
}

/** What the button reads for a moment after a tap (Frank, 2026-09-09: the button itself answers). */
const LABEL: Record<ShareResult, string> = { copied: 'Copied', failed: "Couldn't copy" }

/** Copies the share text to the clipboard and says so on the button. No share sheet. */
export function ShareButton({
  payload,
  analytics,
  className = '',
  testId = 'share',
  label = 'Share',
}: Props) {
  const [state, setState] = useState<ShareResult | null>(null)
  useEffect(() => {
    if (!state) return
    const t = setTimeout(() => setState(null), 1800)
    return () => clearTimeout(t)
  }, [state])
  const onClick = async () => {
    if (state) return
    const result = await share(payload)
    analytics.track('share_clicked', { format: result === 'copied' ? 'clipboard' : 'failed' })
    setState(result)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-state={state ?? 'idle'}
      className={
        'rounded-2xl border-2 font-black transition-colors active:scale-95 ' +
        (state === 'copied'
          ? 'border-accent bg-accent/15 text-accent'
          : state === 'failed'
            ? 'border-miss text-miss'
            : 'border-white/20 text-white') +
        ' ' +
        className
      }
    >
      {state ? LABEL[state] : label}
    </button>
  )
}

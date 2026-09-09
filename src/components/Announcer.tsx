import { useEffect, useState } from 'react'

interface Props {
  /** performance.now() when the timer started; null when not running. */
  revealAt: number | null
  decisionMs: number
  /** Extra one-off message (e.g. the outcome). */
  message?: string | null
  /** Remaining-time marks to announce, in ms. */
  marks?: number[]
}

/**
 * Screen-reader countdown (spec §19): a visually hidden polite live region
 * that announces "3 seconds" and "1 second" as the timer passes those marks.
 */
export function Announcer({ revealAt, decisionMs, message = null, marks = [3000, 1000] }: Props) {
  const [countdown, setText] = useState('')
  useEffect(() => {
    if (revealAt === null) return
    const timers = marks
      .map((mark) => {
        const delay = decisionMs - mark - (performance.now() - revealAt)
        if (delay < 0) return null
        return setTimeout(
          () => setText(`${Math.round(mark / 1000)} second${mark >= 2000 ? 's' : ''}`),
          delay,
        )
      })
      .filter((t): t is ReturnType<typeof setTimeout> => t !== null)
    return () => timers.forEach(clearTimeout)
  }, [revealAt, decisionMs, marks])
  // A one-off message wins over the countdown while it is set.
  const text = message ?? countdown
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
      {text}
    </div>
  )
}

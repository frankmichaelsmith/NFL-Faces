import { useEffect, useRef } from 'react'

interface Props {
  /** performance.now() when the faces were painted; null = timer not running. */
  revealAt: number | null
  decisionMs: number
  /** Freeze the bar (after a tap or a miss). */
  frozen: boolean
  /** Turn the bar into a warning colour with this much time left. */
  warnAtMs?: number
}

/**
 * Full-width bar that drains left to right on the monotonic clock. The width
 * is written straight to the DOM each frame; React never re-renders for it.
 */
export function TimerBar({ revealAt, decisionMs, frozen, warnAtMs = 1000 }: Props) {
  const fill = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = fill.current
    if (!el) return
    if (revealAt === null) {
      el.style.transform = 'scaleX(1)'
      el.dataset.warn = 'false'
      return
    }
    if (frozen) return
    let raf = 0
    const tick = () => {
      const left = Math.max(0, decisionMs - (performance.now() - revealAt))
      el.style.transform = `scaleX(${left / decisionMs})`
      el.dataset.warn = String(left <= warnAtMs)
      if (left > 0) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [revealAt, decisionMs, frozen, warnAtMs])

  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
      role="timer"
      aria-label="Decision timer"
    >
      <div
        ref={fill}
        data-testid="timer-fill"
        className="h-full w-full origin-left rounded-full bg-accent transition-colors data-[warn=true]:bg-warn"
      />
    </div>
  )
}

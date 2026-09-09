import { useEffect, useRef, useState } from 'react'
import {
  CENTER_TOP_PX,
  cyclesFor,
  drumPose,
  ITEM_HEIGHT_PX,
  reelEase,
  reelStrip,
  VIEWPORT_HEIGHT_PX,
} from './reel-math'

interface Props {
  /** What the wheel shows; decides how a value is typeset. */
  kind?: 'season' | 'team' | 'role' | 'player' | 'category'
  /** Every value on this wheel, in strip order. */
  values: readonly string[]
  /** Where this spin lands. */
  target: string
  /** Time from mount until the hard stop. */
  durationMs: number
  /** Whether this mount should animate at all (false once the round is past the spin). */
  spin: boolean
  reduceMotion: boolean
  onLand?: () => void
  testId?: string
}

/**
 * One slot-machine drum. The window is two rows tall: the landed value sits
 * in the middle with half of each neighbour showing above and below. Rows
 * are tilted around the X axis by their distance from the centre, so the
 * strip reads as a cylinder. The spin is driven by requestAnimationFrame
 * (a monotonic spin-down, no overshoot) because each row's tilt
 * depends on where the strip is at that instant.
 */
export function Reel({
  kind = 'team',
  values,
  target,
  durationMs,
  spin,
  reduceMotion,
  onLand,
  testId,
}: Props) {
  const [landed, setLanded] = useState(!spin)
  // Decided once per mount: the strip stays put after landing.
  const [animate] = useState(spin && !reduceMotion)
  const stripRef = useRef<HTMLDivElement>(null)
  const strip = reelStrip(values, target, cyclesFor(durationMs, values.length))

  // Landing is timed, not derived from the animation, so tests and slow tabs agree.
  useEffect(() => {
    if (!spin) return
    const t = setTimeout(() => {
      setLanded(true)
      onLand?.()
    }, durationMs)
    return () => clearTimeout(t)
  }, [spin, durationMs, onLand])

  // Drive the strip and pose the rows near the window each frame.
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const rows = Array.from(el.children) as HTMLElement[]
    const pose = (raw: number) => {
      // Never scroll past the landing point or before the first row: a row is always in the window.
      const y = Math.min(0, Math.max(strip.finalY, raw))
      el.style.transform = `translateY(${y}px)`
      const centre = VIEWPORT_HEIGHT_PX / 2
      const first = Math.max(0, Math.floor((-y - ITEM_HEIGHT_PX) / ITEM_HEIGHT_PX))
      const last = Math.min(rows.length - 1, first + 4)
      for (let i = first; i <= last; i++) {
        const rowCentre = y + i * ITEM_HEIGHT_PX + ITEM_HEIGHT_PX / 2
        const p = drumPose(rowCentre - centre)
        const row = rows[i]!
        row.style.transform = `rotateX(${p.rotateX}deg) scale(${p.scale})`
        row.style.opacity = String(p.opacity)
      }
    }
    if (!animate) {
      pose(strip.finalY)
      return
    }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      pose(strip.finalY * reelEase(p))
      el.classList.toggle('reel-spinning', p < 0.6)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      data-testid={testId}
      data-value={target}
      data-settled={landed}
      className={
        'reel reel-drum relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-black/50 via-white/[0.07] to-black/50 ' +
        (landed ? 'reel-landed' : '')
      }
      style={{ height: VIEWPORT_HEIGHT_PX }}
    >
      <div ref={stripRef} className="reel-strip will-change-transform">
        {strip.items.map((v, i) => (
          <div
            key={i}
            aria-hidden={i !== strip.landIndex}
            className="reel-item flex items-center justify-center overflow-hidden"
            style={{ height: ITEM_HEIGHT_PX }}
          >
            <ReelLabel kind={kind} value={v} />
          </div>
        ))}
      </div>
      {!landed && !animate && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/70 text-3xl text-white/25">
          · · ·
        </div>
      )}
      {/* drum shading: dark at the rim, a light band across the centre row */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-ink/95 to-transparent"
        style={{ height: CENTER_TOP_PX }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/95 to-transparent"
        style={{ height: CENTER_TOP_PX }}
      />
      <div
        className="pointer-events-none absolute inset-x-1 rounded-md border border-white/25 shadow-[inset_0_0_18px_rgba(255,255,255,0.08)]"
        style={{ top: CENTER_TOP_PX, height: ITEM_HEIGHT_PX }}
        aria-hidden
      />
    </div>
  )
}

/**
 * Typeset one reel value so it always fits the reel width (~105 px on a phone):
 * seasons and team codes stay big; player names split into first/last with the
 * last name sized by length; categories wrap to two short lines.
 */
export function ReelLabel({ kind, value }: { kind: NonNullable<Props['kind']>; value: string }) {
  if (kind === 'player') {
    const parts = value.split(' ')
    let last = parts.length > 1 ? parts.pop()! : value
    // "Marvin Harrison Jr." keeps the suffix with the surname, not as the big word.
    if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 1)
      last = `${parts.pop()!} ${last}`
    const first = parts.join(' ')
    const size = last.length > 11 ? 'text-sm' : last.length > 8 ? 'text-base' : 'text-xl'
    return (
      <div className="flex w-full flex-col items-center px-3 leading-none">
        {first && (
          <span className="w-full truncate text-center text-[11px] font-bold uppercase tracking-wide text-white/60">
            {first}
          </span>
        )}
        <span className={`font-display w-full truncate text-center font-black ${size}`}>
          {last}
        </span>
      </div>
    )
  }
  if (kind === 'category') {
    return (
      <span className="font-display px-2 text-center text-lg font-black uppercase leading-tight">
        {value}
      </span>
    )
  }
  const size = value.length > 9 ? 'text-lg' : value.length > 7 ? 'text-xl' : 'text-2xl'
  return (
    <span
      className={`font-display w-full truncate px-3 text-center font-black tracking-wide ${size}`}
    >
      {value}
    </span>
  )
}

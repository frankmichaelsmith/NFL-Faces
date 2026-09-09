import { useEffect, useState } from 'react'
import { cyclesFor, ITEM_HEIGHT_PX, reelStrip, VIEWPORT_HEIGHT_PX } from './reel-math'

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
 * One slot-machine reel. Mounted fresh every round: the strip animates from
 * the top to the landing item over `durationMs` with a mechanical overshoot,
 * blurred while moving. With reduced motion the value simply fades in at the
 * landing time, keeping the left-to-right cadence.
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
  useEffect(() => {
    if (!spin) return
    const t = setTimeout(() => {
      setLanded(true)
      onLand?.()
    }, durationMs)
    return () => clearTimeout(t)
  }, [spin, durationMs, onLand])

  const strip = reelStrip(values, target, cyclesFor(durationMs, values.length))
  // Decided once per mount: the strip stays put after landing rather than
  // swapping to a static label when the round moves on.
  const [animate] = useState(spin && !reduceMotion)

  return (
    <div
      data-testid={testId}
      data-value={target}
      data-settled={landed}
      className={
        'reel relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/10 via-black/20 to-black/40 ' +
        (landed ? 'reel-landed' : '')
      }
      style={{ height: VIEWPORT_HEIGHT_PX }}
    >
      {animate ? (
        <div
          className={'reel-strip will-change-transform ' + (landed ? '' : 'reel-spinning')}
          style={
            {
              '--reel-final': `${strip.finalY}px`,
              animation: `reel ${durationMs}ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards`,
            } as React.CSSProperties
          }
        >
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
      ) : (
        <div
          className={
            'flex h-full flex-col transition-opacity duration-200 ' +
            (landed ? 'opacity-100' : 'opacity-0')
          }
        >
          {neighbours(values, target).map((v, i) => (
            <div
              key={i}
              className="reel-item flex items-center justify-center overflow-hidden"
              style={{ height: ITEM_HEIGHT_PX }}
            >
              <ReelLabel kind={kind} value={v} />
            </div>
          ))}
        </div>
      )}
      {!landed && !animate && (
        <div className="absolute inset-0 flex items-center justify-center text-3xl text-white/25">
          · · ·
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-ink/90 via-ink/60 to-transparent"
        style={{ height: ITEM_HEIGHT_PX }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/60 to-transparent"
        style={{ height: ITEM_HEIGHT_PX }}
      />
      <div
        className="pointer-events-none absolute inset-x-1 rounded-lg border border-white/20"
        style={{ top: ITEM_HEIGHT_PX, height: ITEM_HEIGHT_PX }}
        aria-hidden
      />
    </div>
  )
}

/**
 * Typeset one reel value so it always fits the reel width (~110 px on a phone):
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
      className={`font-display w-full truncate px-1 text-center font-black tracking-wide ${size}`}
    >
      {value}
    </span>
  )
}

/** The value above, the value itself, and the value below, for the non-animated window. */
function neighbours(values: readonly string[], target: string): string[] {
  const i = Math.max(0, values.indexOf(target))
  const n = values.length
  if (n === 0) return ['', target, '']
  return [values[(i - 1 + n) % n]!, target, values[(i + 1) % n]!]
}

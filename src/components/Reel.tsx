import { useEffect, useState } from 'react'
import { cyclesFor, ITEM_HEIGHT_PX, reelStrip } from './reel-math'

interface Props {
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
export function Reel({ values, target, durationMs, spin, reduceMotion, onLand, testId }: Props) {
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
      style={{ height: ITEM_HEIGHT_PX }}
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
              className="reel-item flex items-center justify-center font-display text-3xl font-black tracking-wide"
              style={{ height: ITEM_HEIGHT_PX }}
            >
              {v}
            </div>
          ))}
        </div>
      ) : (
        <div
          className={
            'reel-item flex h-full items-center justify-center font-display text-3xl font-black tracking-wide transition-opacity duration-200 ' +
            (landed ? 'opacity-100' : 'opacity-0')
          }
        >
          {target}
        </div>
      )}
      {!landed && !animate && (
        <div className="absolute inset-0 flex items-center justify-center text-3xl text-white/25">
          · · ·
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-ink/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-ink/80 to-transparent" />
    </div>
  )
}

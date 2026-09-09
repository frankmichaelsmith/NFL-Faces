import { useEffect, useState } from 'react'
import type { Bundle } from '../game/bundle'
import type { GameConfig } from '../game/config'
import type { Round } from '../game/select'

interface Props {
  bundle: Bundle
  config: GameConfig
  round: Round | null
  spinning: boolean
}

/** Label for one wheel given the roll. Teams read in caps on the reel. */
export function wheelValue(
  bundle: Bundle,
  kind: GameConfig['wheels'][number]['kind'],
  round: Round,
): string {
  switch (kind) {
    case 'season':
      return String(round.combo.season)
    case 'team':
      return (
        bundle.teams.find((t) => t.id === round.combo.team)?.label ?? round.combo.team
      ).toUpperCase()
    case 'role':
      return round.combo.role
  }
}

/**
 * M3: static wheels that reveal left to right, one per spinMsPerWheel.
 * M4 replaces the reveal with a reel animation; the landing cadence stays.
 */
export function Wheels({ bundle, config, round, spinning }: Props) {
  // The parent remounts this component every round (key = roundIndex), so
  // `landed` starts at 0 for each spin without any reset logic.
  const [landed, setLanded] = useState(0)
  useEffect(() => {
    if (!spinning) return
    const timers = config.wheels.map((_, i) =>
      setTimeout(() => setLanded(i + 1), (i + 1) * config.spinMsPerWheel - 60),
    )
    return () => timers.forEach(clearTimeout)
  }, [spinning, config.wheels, config.spinMsPerWheel])

  const showAll = !spinning && round !== null
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${config.wheels.length}, minmax(0, 1fr))` }}
    >
      {config.wheels.map((w, i) => {
        const settled = round !== null && (showAll || landed > i)
        return (
          <div
            key={w.kind}
            data-testid={`wheel-${w.kind}`}
            data-settled={settled}
            className={
              'flex h-20 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/10 to-black/30 px-2 text-center font-black tracking-wide ' +
              (settled ? 'text-2xl text-white' : 'text-3xl text-white/25 animate-pulse')
            }
          >
            {settled ? wheelValue(bundle, w.kind, round) : '· · ·'}
          </div>
        )
      })}
    </div>
  )
}

import { useMemo } from 'react'
import type { Bundle } from '../game/bundle'
import type { GameConfig } from '../game/config'
import { CATEGORY_LABELS } from '../game/probowl'
import type { AnyRound } from '../state/machine'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { Reel } from './Reel'

interface Props {
  bundle: Bundle
  config: GameConfig
  round: AnyRound | null
  /** True while the round is in its spin phase. */
  spinning: boolean
  /** Fired when wheel `index` lands (M7 plays the tick). */
  onLand?: (index: number) => void
}

type Kind = GameConfig['wheels'][number]['kind']

/** Label for one wheel given the roll. Teams read in caps on the reel. */
export function wheelValue(bundle: Bundle, kind: Kind, round: AnyRound): string {
  switch (kind) {
    case 'season':
      return String(round.combo.season)
    case 'team':
      return round.kind === 'faces'
        ? (
            bundle.teams.find((t) => t.id === round.combo.team)?.label ?? round.combo.team
          ).toUpperCase()
        : ''
    case 'role':
      return round.kind === 'faces' ? round.combo.role : ''
    case 'player':
      return round.kind === 'probowl'
        ? (bundle.probowl?.players[round.combo.player]?.name ?? '')
        : ''
    case 'category':
      return round.kind === 'probowl' ? CATEGORY_LABELS[round.combo.category] : ''
  }
}

/** Every value a wheel can show, in strip order. The player reel is that season's Pro Bowlers. */
export function wheelValues(bundle: Bundle, kind: Kind, round: AnyRound | null = null): string[] {
  switch (kind) {
    case 'season': {
      const out: string[] = []
      for (let s = bundle.firstSeason; s <= bundle.lastSeason; s++) out.push(String(s))
      return out
    }
    case 'team':
      return bundle.teams.map((t) => t.label.toUpperCase())
    case 'role':
      return bundle.roles
    case 'player': {
      const pb = bundle.probowl
      if (!pb) return []
      const ids = round ? (pb.rosters[String(round.combo.season)] ?? []) : Object.keys(pb.players)
      return ids.map((id) => pb.players[id]?.name ?? id)
    }
    case 'category':
      return Object.values(CATEGORY_LABELS)
  }
}

/**
 * The wheels. Mounted fresh every round by the parent (key = roundIndex), so
 * each mount is one spin: all reels move from t=0 and stop left to right,
 * wheel i landing at (i + 1) × spinMsPerWheel.
 */
export function Wheels({ bundle, config, round, spinning, onLand }: Props) {
  const reduceMotion = useReducedMotion()
  const values = useMemo(
    () => config.wheels.map((w) => wheelValues(bundle, w.kind, round)),
    [bundle, config.wheels, round],
  )
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${config.wheels.length}, minmax(0, 1fr))` }}
    >
      {config.wheels.map((w, i) =>
        round ? (
          <Reel
            key={w.kind}
            testId={`wheel-${w.kind}`}
            values={values[i]!}
            target={wheelValue(bundle, w.kind, round)}
            durationMs={(i + 1) * config.spinMsPerWheel}
            spin={spinning}
            reduceMotion={reduceMotion}
            onLand={onLand ? () => onLand(i) : undefined}
          />
        ) : (
          <div
            key={w.kind}
            data-testid={`wheel-${w.kind}`}
            className="h-20 rounded-xl border border-white/10 bg-black/20"
          />
        ),
      )}
    </div>
  )
}

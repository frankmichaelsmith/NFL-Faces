/**
 * Game configuration. Everything that makes this edition "NFL, quarterbacks,
 * 2000 onward, two wheels" lives here so a position wheel or another league can
 * come back later without touching game logic (CLAUDE.md, locked decisions).
 */

export type WheelKind = 'season' | 'team' | 'role' | 'player' | 'category'

export interface WheelConfig {
  kind: WheelKind
  label: string
}

export interface GameConfig {
  /** Wheels in left-to-right stop order. */
  wheels: readonly WheelConfig[]
  /** First season on the season wheel (inclusive). */
  firstSeason: number
  /** Role ids in play. A single role means no role wheel is shown. */
  roles: readonly string[]
  /** Decision timer, milliseconds. Never varies with streak length. */
  decisionMs: number
  /** Spin-and-land time per wheel; wheels stop left to right, one after another. */
  spinMsPerWheel: number
  /** Green flash after a correct tap before the next spin starts on its own. */
  feedbackMs: number
  /** Per-slot probability that a distractor is drawn from the alumni pool. */
  alumniProb: number
  /**
   * Relative frequency of each value on the category wheel (missing = 1).
   * The roll picks a category by weight, then a combo uniformly within it.
   */
  categoryWeights?: Readonly<Record<string, number>>
  /** Relative frequency of a season on the season wheel (missing = 1), keyed by season. */
  seasonWeights?: Readonly<Record<string, number>>
}

export type Mode = 'faces' | 'probowl'

export const MODE_LABELS: Record<Mode, string> = { faces: 'Faces', probowl: 'Pro Bowl Mode' }

export const GAME_CONFIG: GameConfig = {
  wheels: [
    { kind: 'season', label: 'Season' },
    { kind: 'team', label: 'Team' },
  ],
  firstSeason: 2000,
  roles: ['QB'],
  decisionMs: 6000,
  spinMsPerWheel: 1000,
  feedbackMs: 300,
  alumniProb: 0.3,
}

/** Pro Bowl Mode (decision 0007): season → player → category; same timer, no photos. */
export const PROBOWL_CONFIG: GameConfig = {
  ...GAME_CONFIG,
  wheels: [
    { kind: 'season', label: 'Season' },
    { kind: 'player', label: 'Player' },
    { kind: 'category', label: 'Category' },
  ],
  roles: ['QB', 'RB', 'WR', 'TE'],
  // Position is the easy one; Frank (2026-09-09) wants it on ~9% of rolls, the rest even (30.3% each).
  categoryWeights: { alma: 1, draft: 1, number: 1, position: 0.3 },
  // 1995–1999 are in the pool (Frank, 2026-09-09) but land at 30% of a 2000+ season's rate.
  seasonWeights: { 1995: 0.3, 1996: 0.3, 1997: 0.3, 1998: 0.3, 1999: 0.3 },
}

export function configFor(mode: Mode): GameConfig {
  return mode === 'probowl' ? PROBOWL_CONFIG : GAME_CONFIG
}

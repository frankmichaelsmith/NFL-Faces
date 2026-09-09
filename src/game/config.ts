/**
 * Game configuration. Everything that makes this edition "NFL, quarterbacks,
 * 2000 onward, two wheels" lives here so a position wheel or another league can
 * come back later without touching game logic (CLAUDE.md, locked decisions).
 */

export type WheelKind = 'season' | 'team' | 'role'

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
}

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

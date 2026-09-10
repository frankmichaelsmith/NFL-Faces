/**
 * Wire types shared by the leaderboard API (server/) and the app. Pure types:
 * this file must import nothing, because both tsconfig projects include it.
 */

export interface RegisterRequest {
  email: string
  name: string
}
export interface RegisterResponse {
  playerId: string
  name: string
  /** Bearer token for score posts; store it on the device, never show it. */
  token: string
  /** Today's leaderboard day (Eastern calendar date, YYYY-MM-DD). */
  day: string
}

export interface ScoreRequest {
  streak: number
  /** Rounds played in this game (the streak plus the losing round). Feeds the day's total. */
  rounds?: number
  /** The losing roll as shown on screen, e.g. "2003 · Daunte Culpepper · Alma Mater". */
  roll: string | null
  mode: 'probowl' | 'faces'
}
export interface ScoreResponse {
  day: string
  /** Best streak recorded for this player today after this post. */
  best: number
  /** Whether this post raised today's best. */
  improved: boolean
  rank: number
}

export interface LeaderboardRow {
  rank: number
  name: string
  streak: number
  /** True on the caller's own row. */
  you: boolean
}
export interface LeaderboardResponse {
  day: string
  mode: 'probowl'
  rows: LeaderboardRow[]
  /** The caller's own standing, also when outside the listed rows; null when unknown or unranked. */
  you: { rank: number; streak: number; name: string; roll: string | null } | null
  /** Players with a score today. */
  players: number
  /** Rounds played today across every posted game. */
  rounds: number
}

/** Who played how much on one day (names are already public on the board). */
export interface StatsResponse {
  day: string
  mode: 'probowl'
  /** Players with at least one posted game, most rounds first. */
  players: { name: string; rounds: number; games: number; best: number }[]
  rounds: number
  games: number
}

export interface HealthResponse {
  ok: boolean
  store: 'neon' | 'memory'
  day: string
  version: string
}

export interface ApiError {
  error: string
  message: string
}

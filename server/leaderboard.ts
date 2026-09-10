/**
 * Daily leaderboard domain (decision 0008). Pure functions over a
 * LeaderboardStore, a clock and a token minter, so every rule is unit-tested
 * without a network or a database.
 *
 * - A player is an email (lower-cased, unique) with a display name and one
 *   bearer token per device. Registering an email again adds a token and may
 *   rename; every device the player joined on stays signed in (Frank,
 *   2026-09-09). No verification: fastest to ship, typos and fakes accepted.
 * - The board is Pro Bowl Mode only, one row per player per Eastern calendar
 *   day: the best streak of the day, ties broken by who reached it first.
 * - A score post never lowers a day's best; a lower or equal streak is a
 *   no-op that still reports the standing.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  LeaderboardResponse,
  LeaderboardRow,
  RegisterResponse,
  ScoreResponse,
  StatsResponse,
} from '../src/leaderboard/types.js'

export const BOARD_MODE = 'probowl' as const
export const BOARD_SIZE = 25
/** A streak cannot exceed the Pro Bowl player pool; anything above is not a real game. */
export const MAX_STREAK = 1000

export interface Player {
  id: string
  email: string
  name: string
  createdAt: string
  updatedAt: string
}
export interface DailyScore {
  playerId: string
  day: string
  mode: string
  streak: number
  roll: string | null
  achievedAt: string
}
export interface RankedScore extends DailyScore {
  name: string
}
/** One player's activity on one day and mode: every post counts, improving or not. */
export interface PlayerDay {
  playerId: string
  day: string
  mode: string
  rounds: number
  games: number
}
/** Running totals for one day and mode, bumped by every score post (improving or not). */
export interface DailyTotals {
  day: string
  mode: string
  rounds: number
  games: number
}

export interface LeaderboardStore {
  findPlayerByEmail(email: string): Promise<Player | null>
  findPlayerByTokenHash(hash: string): Promise<Player | null>
  /** Insert, or replace every field of the player with this email. */
  upsertPlayer(player: Player): Promise<void>
  /** Remember one more device token for the player. Existing tokens stay valid. */
  addToken(playerId: string, tokenHash: string, createdAt: string): Promise<void>
  getScore(playerId: string, day: string, mode: string): Promise<DailyScore | null>
  /** Insert or replace the (player, day, mode) row. */
  putScore(score: DailyScore): Promise<void>
  /** Best first; equal streaks ordered by achievedAt ascending. */
  topScores(day: string, mode: string, limit: number): Promise<RankedScore[]>
  /** 1 + the number of rows that beat this one (higher streak, or same streak reached earlier). */
  rankOf(score: DailyScore): Promise<number>
  countScores(day: string, mode: string): Promise<number>
  /** Add one game of `rounds` rounds to the day's totals. */
  addGame(day: string, mode: string, rounds: number): Promise<void>
  totals(day: string, mode: string): Promise<DailyTotals>
  /** Add one game of `rounds` rounds to the player's own day. */
  addPlayerGame(playerId: string, day: string, mode: string, rounds: number): Promise<void>
  /** Every player's activity for the day, most rounds first, with their best streak and name. */
  playerDays(day: string, mode: string): Promise<(PlayerDay & { name: string; best: number })[]>
}

// ---- time ---------------------------------------------------------------------------------

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
/** The leaderboard day for an instant: the calendar date in New York. */
export function etDay(now: Date): string {
  return ET_DAY.format(now)
}
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// ---- validation ----------------------------------------------------------------------------

export const NAME_MIN = 2
export const NAME_MAX = 20
const nameSchema = z
  .string()
  .trim()
  .min(NAME_MIN, `Name must be at least ${NAME_MIN} characters`)
  .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters`)
  .regex(/^[\p{L}\p{N} ._'-]+$/u, "Name can use letters, numbers, spaces and . _ ' -")
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address')),
  name: nameSchema,
})
export const scoreSchema = z.object({
  streak: z.number().int().min(0).max(MAX_STREAK),
  // Older clients post no rounds; a game is its streak plus the round that ended it.
  rounds: z
    .number()
    .int()
    .min(0)
    .max(MAX_STREAK + 1)
    .optional(),
  roll: z.string().trim().max(120).nullable().default(null),
  mode: z.enum(['probowl', 'faces']),
})

export interface Result<T> {
  status: number
  body: T | { error: string; message: string }
}
const fail = (status: number, error: string, message: string): Result<never> => ({
  status,
  body: { error, message },
})
function firstIssue(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'Invalid input'
}

// ---- tokens ---------------------------------------------------------------------------------

export function mintToken(): string {
  return randomBytes(24).toString('base64url')
}
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---- handlers -----------------------------------------------------------------------------

export interface Deps {
  store: LeaderboardStore
  now: () => Date
  mint?: () => string
  newId?: () => string
}

export async function register(deps: Deps, input: unknown): Promise<Result<RegisterResponse>> {
  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) return fail(400, 'invalid', firstIssue(parsed.error))
  const { email, name } = parsed.data
  const now = deps.now()
  const token = (deps.mint ?? mintToken)()
  const existing = await deps.store.findPlayerByEmail(email)
  const player: Player = {
    id: existing?.id ?? (deps.newId ?? randomUUID)(),
    email,
    name,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  }
  await deps.store.upsertPlayer(player)
  await deps.store.addToken(player.id, hashToken(token), now.toISOString())
  return {
    status: existing ? 200 : 201,
    body: { playerId: player.id, name: player.name, token, day: etDay(now) },
  }
}

export async function authenticate(deps: Deps, token: string | null): Promise<Player | null> {
  if (!token) return null
  return deps.store.findPlayerByTokenHash(hashToken(token))
}

export async function postScore(
  deps: Deps,
  token: string | null,
  input: unknown,
): Promise<Result<ScoreResponse>> {
  const player = await authenticate(deps, token)
  if (!player) return fail(401, 'unauthorized', 'Add your email to join the leaderboard')
  const parsed = scoreSchema.safeParse(input)
  if (!parsed.success) return fail(400, 'invalid', firstIssue(parsed.error))
  const { streak, roll, mode } = parsed.data
  const now = deps.now()
  const day = etDay(now)
  const rounds = parsed.data.rounds ?? streak + 1
  await deps.store.addGame(day, mode, rounds)
  await deps.store.addPlayerGame(player.id, day, mode, rounds)
  const current = await deps.store.getScore(player.id, day, mode)
  let best = current
  let improved = false
  if (streak > 0 && (!current || streak > current.streak)) {
    best = { playerId: player.id, day, mode, streak, roll, achievedAt: now.toISOString() }
    await deps.store.putScore(best)
    improved = true
  }
  const rank = best ? await deps.store.rankOf(best) : 0
  return { status: 200, body: { day, best: best?.streak ?? 0, improved, rank } }
}

export async function leaderboard(
  deps: Deps,
  token: string | null,
  dayParam: string | null,
): Promise<Result<LeaderboardResponse>> {
  if (dayParam !== null && !DAY_RE.test(dayParam))
    return fail(400, 'invalid', 'day must be YYYY-MM-DD')
  const day = dayParam ?? etDay(deps.now())
  const me = await authenticate(deps, token)
  const top = await deps.store.topScores(day, BOARD_MODE, BOARD_SIZE)
  const rows: LeaderboardRow[] = top.map((s, i) => ({
    rank: i + 1,
    name: s.name,
    streak: s.streak,
    you: me?.id === s.playerId,
  }))
  let you: LeaderboardResponse['you'] = null
  if (me) {
    const mine = await deps.store.getScore(me.id, day, BOARD_MODE)
    if (mine) you = { rank: await deps.store.rankOf(mine), streak: mine.streak, name: me.name }
  }
  const players = await deps.store.countScores(day, BOARD_MODE)
  const { rounds } = await deps.store.totals(day, BOARD_MODE)
  return { status: 200, body: { day, mode: BOARD_MODE, rows, you, players, rounds } }
}

/** Who played how much today (or on `dayParam`). Public: it shows only board names and counts. */
export async function stats(deps: Deps, dayParam: string | null): Promise<Result<StatsResponse>> {
  if (dayParam !== null && !DAY_RE.test(dayParam))
    return fail(400, 'invalid', 'day must be YYYY-MM-DD')
  const day = dayParam ?? etDay(deps.now())
  const rows = await deps.store.playerDays(day, BOARD_MODE)
  const t = await deps.store.totals(day, BOARD_MODE)
  return {
    status: 200,
    body: {
      day,
      mode: BOARD_MODE,
      players: rows.map((r) => ({ name: r.name, rounds: r.rounds, games: r.games, best: r.best })),
      rounds: t.rounds,
      games: t.games,
    },
  }
}

// ---- in-memory store (dev and tests) ----------------------------------------------------------

/** Ordering shared by every store: best streak first, earliest achievement first among equals. */
export function beats(a: DailyScore, b: DailyScore): boolean {
  return a.streak > b.streak || (a.streak === b.streak && a.achievedAt < b.achievedAt)
}

export class InMemoryLeaderboardStore implements LeaderboardStore {
  players = new Map<string, Player>() // by id
  tokens = new Map<string, string>() // token hash → player id
  scores = new Map<string, DailyScore>() // by player:day:mode
  dayTotals = new Map<string, DailyTotals>() // by day:mode
  playerDayMap = new Map<string, PlayerDay>() // by player:day:mode

  async findPlayerByEmail(email: string) {
    return [...this.players.values()].find((p) => p.email === email) ?? null
  }
  async findPlayerByTokenHash(hash: string) {
    const id = this.tokens.get(hash)
    return id ? (this.players.get(id) ?? null) : null
  }
  async upsertPlayer(player: Player) {
    this.players.set(player.id, player)
  }
  async addToken(playerId: string, tokenHash: string) {
    this.tokens.set(tokenHash, playerId)
  }
  async getScore(playerId: string, day: string, mode: string) {
    return this.scores.get(`${playerId}:${day}:${mode}`) ?? null
  }
  async putScore(score: DailyScore) {
    this.scores.set(`${score.playerId}:${score.day}:${score.mode}`, score)
  }
  private forDay(day: string, mode: string) {
    return [...this.scores.values()].filter((s) => s.day === day && s.mode === mode)
  }
  async topScores(day: string, mode: string, limit: number) {
    return this.forDay(day, mode)
      .sort((a, b) => (beats(a, b) ? -1 : beats(b, a) ? 1 : 0))
      .slice(0, limit)
      .map((s) => ({ ...s, name: this.players.get(s.playerId)?.name ?? '?' }))
  }
  async rankOf(score: DailyScore) {
    return 1 + this.forDay(score.day, score.mode).filter((s) => beats(s, score)).length
  }
  async countScores(day: string, mode: string) {
    return this.forDay(day, mode).length
  }
  async addGame(day: string, mode: string, rounds: number) {
    const t = await this.totals(day, mode)
    this.dayTotals.set(`${day}:${mode}`, { ...t, rounds: t.rounds + rounds, games: t.games + 1 })
  }
  async totals(day: string, mode: string) {
    return this.dayTotals.get(`${day}:${mode}`) ?? { day, mode, rounds: 0, games: 0 }
  }
  async addPlayerGame(playerId: string, day: string, mode: string, rounds: number) {
    const k = `${playerId}:${day}:${mode}`
    const p = this.playerDayMap.get(k) ?? { playerId, day, mode, rounds: 0, games: 0 }
    this.playerDayMap.set(k, { ...p, rounds: p.rounds + rounds, games: p.games + 1 })
  }
  async playerDays(day: string, mode: string) {
    return [...this.playerDayMap.values()]
      .filter((p) => p.day === day && p.mode === mode)
      .sort((a, b) => b.rounds - a.rounds || b.games - a.games)
      .map((p) => ({
        ...p,
        name: this.players.get(p.playerId)?.name ?? '?',
        best: this.scores.get(`${p.playerId}:${day}:${mode}`)?.streak ?? 0,
      }))
  }
}

/**
 * Postgres persistence for the leaderboard: a Drizzle schema, the idempotent
 * bootstrap SQL run at start-up (as STREAK CITY does; no migration tool), and
 * the store over any Drizzle Postgres database — Neon over HTTP in
 * production, PGlite in tests (server/db.test.ts proves parity).
 */
import { and, asc, count, desc, eq, lt, gt, or, sql } from 'drizzle-orm'
import { integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { DailyScore, LeaderboardStore, Player, RankedScore } from './leaderboard.ts'

// any Drizzle pg database (neon-http, pglite, …)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  token_hash: text('token_hash').notNull().unique(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export const dailyScores = pgTable(
  'daily_scores',
  {
    player_id: text('player_id')
      .notNull()
      .references(() => players.id),
    day: text('day').notNull(),
    mode: text('mode').notNull(),
    streak: integer('streak').notNull(),
    roll: text('roll'),
    achieved_at: text('achieved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.player_id, t.day, t.mode] })],
)

export const ENSURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_scores (
  player_id text NOT NULL REFERENCES players(id),
  day text NOT NULL,
  mode text NOT NULL,
  streak integer NOT NULL,
  roll text,
  achieved_at text NOT NULL,
  PRIMARY KEY (player_id, day, mode)
);
CREATE INDEX IF NOT EXISTS daily_scores_board_idx ON daily_scores (mode, day, streak DESC, achieved_at ASC);
`

/** Run the bootstrap one statement at a time (neon-http accepts a single statement per call). */
export async function ensureSchema(db: Db): Promise<void> {
  for (const statement of ENSURE_SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await db.execute(sql.raw(statement))
}

const toPlayer = (r: typeof players.$inferSelect): Player => ({
  id: r.id,
  email: r.email,
  name: r.name,
  tokenHash: r.token_hash,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})
const toScore = (r: typeof dailyScores.$inferSelect): DailyScore => ({
  playerId: r.player_id,
  day: r.day,
  mode: r.mode,
  streak: r.streak,
  roll: r.roll,
  achievedAt: r.achieved_at,
})

export class DrizzleLeaderboardStore implements LeaderboardStore {
  constructor(private readonly db: Db) {}

  async findPlayerByEmail(email: string) {
    const rows = await this.db.select().from(players).where(eq(players.email, email))
    return rows[0] ? toPlayer(rows[0]) : null
  }
  async findPlayerByTokenHash(hash: string) {
    const rows = await this.db.select().from(players).where(eq(players.token_hash, hash))
    return rows[0] ? toPlayer(rows[0]) : null
  }
  async upsertPlayer(p: Player) {
    const row = {
      id: p.id,
      email: p.email,
      name: p.name,
      token_hash: p.tokenHash,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    }
    await this.db
      .insert(players)
      .values(row)
      .onConflictDoUpdate({ target: players.email, set: row })
  }
  async getScore(playerId: string, day: string, mode: string) {
    const rows = await this.db
      .select()
      .from(dailyScores)
      .where(
        and(
          eq(dailyScores.player_id, playerId),
          eq(dailyScores.day, day),
          eq(dailyScores.mode, mode),
        ),
      )
    return rows[0] ? toScore(rows[0]) : null
  }
  async putScore(s: DailyScore) {
    const row = {
      player_id: s.playerId,
      day: s.day,
      mode: s.mode,
      streak: s.streak,
      roll: s.roll,
      achieved_at: s.achievedAt,
    }
    await this.db
      .insert(dailyScores)
      .values(row)
      .onConflictDoUpdate({
        target: [dailyScores.player_id, dailyScores.day, dailyScores.mode],
        set: row,
      })
  }
  async topScores(day: string, mode: string, limit: number): Promise<RankedScore[]> {
    const rows = await this.db
      .select({ score: dailyScores, name: players.name })
      .from(dailyScores)
      .innerJoin(players, eq(players.id, dailyScores.player_id))
      .where(and(eq(dailyScores.day, day), eq(dailyScores.mode, mode)))
      .orderBy(desc(dailyScores.streak), asc(dailyScores.achieved_at))
      .limit(limit)
    return rows.map((r) => ({ ...toScore(r.score), name: r.name }))
  }
  async rankOf(s: DailyScore) {
    const rows = await this.db
      .select({ n: count() })
      .from(dailyScores)
      .where(
        and(
          eq(dailyScores.day, s.day),
          eq(dailyScores.mode, s.mode),
          or(
            gt(dailyScores.streak, s.streak),
            and(eq(dailyScores.streak, s.streak), lt(dailyScores.achieved_at, s.achievedAt)),
          ),
        ),
      )
    return 1 + Number(rows[0]?.n ?? 0)
  }
  async countScores(day: string, mode: string) {
    const rows = await this.db
      .select({ n: count() })
      .from(dailyScores)
      .where(and(eq(dailyScores.day, day), eq(dailyScores.mode, mode)))
    return Number(rows[0]?.n ?? 0)
  }
}

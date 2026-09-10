// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleLeaderboardStore, ensureSchema } from './db'
import { leaderboard, postScore, register, type Deps } from './leaderboard'
import type { LeaderboardResponse, RegisterResponse } from '../src/leaderboard/types'

/**
 * Parity suite: the Drizzle store against real Postgres (PGlite in-process),
 * the same SQL Neon runs in production. Covers the upserts, the composite
 * key, the ordering and the rank count.
 */
let pg: PGlite
let deps: Deps

beforeAll(async () => {
  pg = new PGlite()
  const db = drizzle(pg)
  await ensureSchema(db)
  await ensureSchema(db) // idempotent
  let t = new Date('2026-09-09T20:00:00Z').getTime()
  let n = 0
  deps = {
    store: new DrizzleLeaderboardStore(db),
    now: () => new Date((t += 1000)),
    mint: () => `tok${++n}`,
    newId: () => `p${n}`,
  }
}, 120_000)

afterAll(async () => {
  await pg.close()
})

describe('DrizzleLeaderboardStore', () => {
  it('round-trips players, rotates tokens on re-register, and keeps daily bests', async () => {
    const a = (await register(deps, { email: 'Ann@x.co', name: 'Ann' })).body as RegisterResponse
    const b = (await register(deps, { email: 'ben@x.co', name: 'Ben' })).body as RegisterResponse
    const c = (await register(deps, { email: 'cal@x.co', name: 'Cal' })).body as RegisterResponse
    expect(a.playerId).toBe('p1')
    await postScore(deps, a.token, { streak: 5, roll: 'r', mode: 'probowl' })
    await postScore(deps, b.token, { streak: 9, roll: null, mode: 'probowl' })
    await postScore(deps, c.token, { streak: 5, roll: null, mode: 'probowl' })
    await postScore(deps, a.token, { streak: 3, roll: null, mode: 'probowl' }) // lower: ignored
    await postScore(deps, a.token, { streak: 40, roll: null, mode: 'faces' }) // other mode: not on the board
    const board = (await leaderboard(deps, c.token, null)).body as LeaderboardResponse
    expect(board.rows.map((r) => `${r.rank} ${r.name} ${r.streak}${r.you ? ' *' : ''}`)).toEqual([
      '1 Ben 9',
      '2 Ann 5',
      '3 Cal 5 *',
    ])
    expect(board.you).toEqual({ rank: 3, streak: 5, name: 'Cal' })
    expect(board.players).toBe(3)
    expect(board.rounds).toBe(6 + 10 + 6 + 4) // four Pro Bowl posts, each streak + 1
    await postScore(deps, a.token, { streak: 1, rounds: 2, roll: null, mode: 'probowl' })
    expect(await deps.store.totals('2026-09-09', 'probowl')).toMatchObject({ rounds: 28, games: 5 })
    // re-register from another device: same player id, new name, and both tokens keep working
    const a2 = (await register(deps, { email: 'ANN@x.co', name: 'Annie' })).body as RegisterResponse
    expect(a2.playerId).toBe('p1')
    expect(
      (await postScore(deps, a.token, { streak: 1, roll: null, mode: 'probowl' })).status,
    ).toBe(200)
    expect(
      (await postScore(deps, 'bogus', { streak: 1, roll: null, mode: 'probowl' })).status,
    ).toBe(401)
    const again = (await leaderboard(deps, a2.token, null)).body as LeaderboardResponse
    expect(again.rows[1]).toMatchObject({ name: 'Annie', streak: 5, you: true })
    expect(await deps.store.getScore('p1', '2026-09-09', 'probowl')).toMatchObject({
      streak: 5,
      roll: 'r',
    })
  })
})

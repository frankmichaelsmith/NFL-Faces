import { describe, expect, it } from 'vitest'
import {
  InMemoryLeaderboardStore,
  etDay,
  hashToken,
  leaderboard,
  postScore,
  register,
  stats,
  type Deps,
} from './leaderboard'
import { route } from './http'
import type {
  LeaderboardResponse,
  RegisterResponse,
  ScoreResponse,
  StatsResponse,
} from '../src/leaderboard/types'

/** A clock that ticks one second per call, starting at a fixed Eastern-evening instant. */
function clock(start = '2026-09-09T20:00:00.000Z') {
  let t = new Date(start).getTime()
  return () => new Date((t += 1000))
}
function fresh(start?: string): Deps {
  let n = 0
  return {
    store: new InMemoryLeaderboardStore(),
    now: clock(start),
    mint: () => `tok${++n}`,
    newId: () => `p${n}`,
  }
}
const ok = <T>(r: { status: number; body: unknown }, status = 200): T => {
  expect(r.status).toBe(status)
  return r.body as T
}
const err = (r: { status: number; body: unknown }) =>
  (r.body as { error: string; message: string }).message

describe('etDay', () => {
  it('is the calendar date in New York, not UTC', () => {
    expect(etDay(new Date('2026-09-10T03:59:00Z'))).toBe('2026-09-09') // 11:59 pm ET
    expect(etDay(new Date('2026-09-10T04:00:00Z'))).toBe('2026-09-10') // midnight ET
    expect(etDay(new Date('2026-01-10T04:59:00Z'))).toBe('2026-01-09') // EST in winter
  })
})

describe('register', () => {
  it('creates a player with a lower-cased email and a token, and returns 201', async () => {
    const d = fresh()
    const r = ok<RegisterResponse>(
      await register(d, { email: ' Frank@Example.com ', name: ' Frank ' }),
      201,
    )
    expect(r).toEqual({ playerId: 'p1', name: 'Frank', token: 'tok1', day: '2026-09-09' })
    const p = await d.store.findPlayerByTokenHash(hashToken('tok1'))
    expect(p?.email).toBe('frank@example.com')
  })
  it('registering the same email on another device keeps the player, renames, and keeps both devices signed in', async () => {
    const d = fresh()
    await register(d, { email: 'a@b.co', name: 'One' })
    const r = ok<RegisterResponse>(await register(d, { email: 'A@B.CO', name: 'Two' }), 200)
    expect(r.playerId).toBe('p1')
    expect(r.name).toBe('Two')
    expect(r.token).toBe('tok2')
    // the first device's token still works (Frank, 2026-09-09: stay signed in everywhere)
    expect((await d.store.findPlayerByTokenHash(hashToken('tok1')))?.name).toBe('Two')
    expect((await d.store.findPlayerByTokenHash(hashToken('tok2')))?.id).toBe('p1')
  })
  it('rejects bad emails and names with a readable message', async () => {
    const d = fresh()
    expect(err(await register(d, { email: 'nope', name: 'Frank' }))).toMatch(/valid email/)
    expect(err(await register(d, { email: 'a@b.co', name: 'F' }))).toMatch(/at least 2/)
    expect(err(await register(d, { email: 'a@b.co', name: 'x'.repeat(21) }))).toMatch(/at most 20/)
    expect(err(await register(d, { email: 'a@b.co', name: '<b>hi</b>' }))).toMatch(/letters/)
    expect((await register(d, null)).status).toBe(400)
  })
})

describe('postScore', () => {
  it('needs a valid token', async () => {
    const d = fresh()
    expect((await postScore(d, null, { streak: 3, roll: null, mode: 'probowl' })).status).toBe(401)
    expect((await postScore(d, 'bogus', { streak: 3, roll: null, mode: 'probowl' })).status).toBe(
      401,
    )
  })
  it('keeps the best streak of the day and never lowers it', async () => {
    const d = fresh()
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    let r = ok<ScoreResponse>(await postScore(d, token, { streak: 4, roll: 'x', mode: 'probowl' }))
    expect(r).toEqual({ day: '2026-09-09', best: 4, improved: true, rank: 1 })
    r = ok<ScoreResponse>(await postScore(d, token, { streak: 2, roll: 'y', mode: 'probowl' }))
    expect(r).toMatchObject({ best: 4, improved: false, rank: 1 })
    r = ok<ScoreResponse>(await postScore(d, token, { streak: 9, roll: 'z', mode: 'probowl' }))
    expect(r).toMatchObject({ best: 9, improved: true })
    expect((await d.store.getScore('p1', '2026-09-09', 'probowl'))?.roll).toBe('z')
  })
  it('every post adds its rounds to the day total, improving or not', async () => {
    const d = fresh()
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    await postScore(d, token, { streak: 4, rounds: 5, roll: null, mode: 'probowl' })
    await postScore(d, token, { streak: 2, rounds: 3, roll: null, mode: 'probowl' })
    await postScore(d, token, { streak: 0, rounds: 1, roll: null, mode: 'probowl' })
    await postScore(d, token, { streak: 9, rounds: 10, roll: null, mode: 'faces' }) // other mode
    const b = ok<LeaderboardResponse>(await leaderboard(d, token, null))
    expect(b.rounds).toBe(9)
    expect(await d.store.totals('2026-09-09', 'probowl')).toMatchObject({ rounds: 9, games: 3 })
    // per player: the same three games, with the day's best alongside
    const { token: t2 } = ok<RegisterResponse>(
      await register(d, { email: 'b@b.co', name: 'Bo' }),
      201,
    )
    await postScore(d, t2, { streak: 7, rounds: 8, roll: null, mode: 'probowl' })
    const s = ok<StatsResponse>(await stats(d, null))
    expect(s.players).toEqual([
      { name: 'Al', rounds: 9, games: 3, best: 4 },
      { name: 'Bo', rounds: 8, games: 1, best: 7 },
    ])
    expect(s).toMatchObject({ day: '2026-09-09', rounds: 17, games: 4 })
    expect((await stats(d, 'nope')).status).toBe(400)
    expect(ok<StatsResponse>(await stats(d, '2020-01-01')).players).toEqual([])
    expect(
      (await postScore(d, token, { streak: 1, rounds: 5000, roll: null, mode: 'probowl' })).status,
    ).toBe(400)
  })
  it('a zero streak records nothing', async () => {
    const d = fresh()
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    const r = ok<ScoreResponse>(
      await postScore(d, token, { streak: 0, roll: null, mode: 'probowl' }),
    )
    expect(r).toMatchObject({ best: 0, improved: false, rank: 0 })
  })
  it('rejects impossible or malformed scores', async () => {
    const d = fresh()
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    expect((await postScore(d, token, { streak: 1001, roll: null, mode: 'probowl' })).status).toBe(
      400,
    )
    expect((await postScore(d, token, { streak: 2.5, roll: null, mode: 'probowl' })).status).toBe(
      400,
    )
    expect((await postScore(d, token, { streak: 2, roll: null, mode: 'chess' })).status).toBe(400)
  })
  it('a new Eastern day starts a new row', async () => {
    const d = fresh('2026-09-10T03:59:50.000Z') // 11:59:50 pm ET; the clock crosses midnight
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    ok<ScoreResponse>(await postScore(d, token, { streak: 7, roll: null, mode: 'probowl' }))
    for (let i = 0; i < 10; i++) d.now()
    const r = ok<ScoreResponse>(
      await postScore(d, token, { streak: 3, roll: null, mode: 'probowl' }),
    )
    expect(r).toEqual({ day: '2026-09-10', best: 3, improved: true, rank: 1 })
  })
})

describe('leaderboard', () => {
  async function seed(d: Deps) {
    const tokens: Record<string, string> = {}
    for (const [name, streak] of [
      ['Ann', 5],
      ['Ben', 9],
      ['Cal', 5],
      ['Dee', 1],
    ] as const) {
      const { token } = ok<RegisterResponse>(
        await register(d, { email: `${name}@x.co`, name }),
        201,
      )
      tokens[name] = token
      await postScore(d, token, { streak, roll: null, mode: 'probowl' })
    }
    return tokens
  }
  it('ranks by best streak, then by who got there first, and marks the caller', async () => {
    const d = fresh()
    const t = await seed(d)
    const b = ok<LeaderboardResponse>(await leaderboard(d, t.Cal!, null))
    expect(b.day).toBe('2026-09-09')
    expect(b.rows.map((r) => `${r.rank} ${r.name} ${r.streak}${r.you ? ' *' : ''}`)).toEqual([
      '1 Ben 9',
      '2 Ann 5',
      '3 Cal 5 *',
      '4 Dee 1',
    ])
    expect(b.you).toEqual({ rank: 3, streak: 5, name: 'Cal', roll: null })
    expect(b.players).toBe(4)
    // rounds: each seeded game posted no rounds field, so it counts streak + 1
    expect(b.rounds).toBe(6 + 10 + 6 + 2)
  })
  it('reports the caller outside the top rows and nothing for the unranked', async () => {
    const d = fresh()
    const t = await seed(d)
    const { token } = ok<RegisterResponse>(await register(d, { email: 'z@x.co', name: 'Zed' }), 201)
    const b = ok<LeaderboardResponse>(await leaderboard(d, token, null))
    expect(b.you).toBeNull()
    expect(b.rows.some((r) => r.you)).toBe(false)
    const anon = ok<LeaderboardResponse>(await leaderboard(d, null, null))
    expect(anon.you).toBeNull()
    expect(anon.rows).toHaveLength(4)
    expect(ok<LeaderboardResponse>(await leaderboard(d, t.Ann!, '2020-01-01')).rows).toEqual([])
    expect((await leaderboard(d, null, 'yesterday')).status).toBe(400)
  })
  it('keeps a separate board per sport: ?mode=nba lists NBA streaks only', async () => {
    const d = fresh()
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    await postScore(d, token, { streak: 5, roll: null, mode: 'probowl' })
    await postScore(d, token, { streak: 12, roll: null, mode: 'nba' })
    const nfl = ok<LeaderboardResponse>(await leaderboard(d, token, null))
    expect(nfl.mode).toBe('probowl')
    expect(nfl.rows.map((r) => r.streak)).toEqual([5])
    const nba = ok<LeaderboardResponse>(await leaderboard(d, token, null, 'nba'))
    expect(nba.mode).toBe('nba')
    expect(nba.rows.map((r) => r.streak)).toEqual([12])
    expect(nba.you).toMatchObject({ rank: 1, streak: 12 })
    expect(ok<LeaderboardResponse>(await leaderboard(d, token, null, 'nfl')).mode).toBe('probowl')
    expect((await leaderboard(d, token, null, 'mlb')).status).toBe(400)
    expect(ok<StatsResponse>(await stats(d, null, 'nba')).players[0]).toMatchObject({ rounds: 13 })
  })
  it('only Pro Bowl Mode scores appear on the board', async () => {
    const d = fresh()
    const { token } = ok<RegisterResponse>(await register(d, { email: 'a@b.co', name: 'Al' }), 201)
    await postScore(d, token, { streak: 30, roll: null, mode: 'faces' })
    await postScore(d, token, { streak: 2, roll: null, mode: 'probowl' })
    const b = ok<LeaderboardResponse>(await leaderboard(d, token, null))
    expect(b.rows).toEqual([{ rank: 1, name: 'Al', streak: 2, you: true }])
  })
})

describe('HTTP routing', () => {
  const runtime = { store: new InMemoryLeaderboardStore(), kind: 'memory' as const }
  const now = clock()
  const call = (path: string, init?: RequestInit) =>
    route(new Request(`http://localhost${path}`, init), runtime, now)
  it('serves health, registers, posts a score with a bearer token, and reads the board', async () => {
    const h = await call('/api/health')
    expect(h.status).toBe(200)
    expect(await h.json()).toMatchObject({ ok: true, store: 'memory', day: '2026-09-09' })
    const reg = await call('/api/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'f@x.co', name: 'Frank' }),
    })
    expect(reg.status).toBe(201)
    const { token } = (await reg.json()) as RegisterResponse
    const sc = await call('/api/score', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ streak: 6, roll: '2003 · X · Alma Mater', mode: 'probowl' }),
    })
    expect(await sc.json()).toMatchObject({ best: 6, rank: 1 })
    const lb = await call('/api/leaderboard?day=2026-09-09')
    expect(((await lb.json()) as LeaderboardResponse).rows[0]).toMatchObject({
      name: 'Frank',
      streak: 6,
    })
    expect(lb.headers.get('cache-control')).toBe('no-store')
  })
  it('answers JSON for wrong methods, bad bodies and unknown paths', async () => {
    expect((await call('/api/register')).status).toBe(405)
    expect((await call('/api/register', { method: 'POST', body: '{not json' })).status).toBe(400)
    expect((await call('/api/nope')).status).toBe(404)
    expect((await call('/api/score', { method: 'POST', body: '{}' })).status).toBe(401)
  })
})

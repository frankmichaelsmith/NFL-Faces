import { describe, expect, it, vi } from 'vitest'
import {
  IDENTITY_KEY,
  QUEUE_KEY,
  addDays,
  createLeaderboardClient,
  formatDay,
} from '../../src/leaderboard/client'

/** A fake /api that records calls and can be knocked offline. */
function fakeApi() {
  const calls: { path: string; method: string; auth: string | null; body: unknown }[] = []
  let offline = false
  let scoreStatus = 200
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      path,
      method: init?.method ?? 'GET',
      auth: headers['authorization'] ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (offline) throw new TypeError('Failed to fetch')
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (path.endsWith('/api/register')) {
      const b = init?.body
        ? (JSON.parse(String(init.body)) as { email: string; name: string })
        : null
      if (!b || !b.email.includes('@'))
        return json(400, { error: 'invalid', message: 'Enter a valid email address' })
      return json(201, { playerId: 'p1', name: b.name, token: 'tok-1', day: '2026-09-09' })
    }
    if (path.endsWith('/api/score')) {
      if (scoreStatus === 401) return json(401, { error: 'unauthorized', message: 'nope' })
      const b = JSON.parse(String(init?.body)) as { streak: number }
      return json(200, { day: '2026-09-09', best: b.streak, improved: true, rank: 2 })
    }
    if (path.includes('/api/leaderboard'))
      return json(200, {
        day: '2026-09-09',
        mode: 'probowl',
        rows: [],
        you: null,
        players: 0,
        rounds: 0,
      })
    return json(404, { error: 'not_found', message: 'no' })
  })
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    calls,
    setOffline: (v: boolean) => (offline = v),
    setScoreStatus: (s: number) => (scoreStatus = s),
  }
}

const score = { streak: 5, roll: '2003 · X · Alma Mater', mode: 'probowl' as const }

describe('leaderboard client', () => {
  it('registers, stores the identity, and posts scores with the bearer token', async () => {
    localStorage.clear()
    const api = fakeApi()
    const c = createLeaderboardClient({ fetch: api.fetchFn })
    expect(c.identity()).toBeNull()
    expect(await c.submitScore(score)).toMatchObject({ ok: false, reason: 'unregistered' })
    const r = await c.register(' Frank@Example.com ', 'Frank')
    expect(r).toEqual({
      ok: true,
      identity: { playerId: 'p1', name: 'Frank', email: 'frank@example.com', token: 'tok-1' },
    })
    expect(JSON.parse(localStorage.getItem(IDENTITY_KEY)!)).toMatchObject({ token: 'tok-1' })
    const s = await c.submitScore(score)
    expect(s).toEqual({ ok: true, result: { day: '2026-09-09', best: 5, improved: true, rank: 2 } })
    const post = api.calls.find((x) => x.path.endsWith('/api/score'))!
    expect(post.auth).toBe('Bearer tok-1')
    expect(post.body).toEqual(score)
    await c.board()
    expect(api.calls.at(-1)).toMatchObject({ path: '/api/leaderboard', auth: 'Bearer tok-1' })
    await c.board('2026-09-09', 'nba')
    expect(api.calls.at(-1)!.path).toBe('/api/leaderboard?day=2026-09-09&mode=nba')
  })
  it('surfaces the server message on a bad sign-up', async () => {
    localStorage.clear()
    const c = createLeaderboardClient({ fetch: fakeApi().fetchFn })
    expect(await c.register('nope', 'Frank')).toEqual({
      ok: false,
      message: 'Enter a valid email address',
    })
    expect(c.identity()).toBeNull()
  })
  it('queues a score while offline and flushes it when back online', async () => {
    localStorage.clear()
    const api = fakeApi()
    const c = createLeaderboardClient({ fetch: api.fetchFn })
    await c.register('a@b.co', 'Al')
    api.setOffline(true)
    const r = await c.submitScore(score)
    expect(r).toMatchObject({ ok: false, reason: 'offline' })
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
    api.setOffline(false)
    await c.flush()
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull()
    const posts = api.calls.filter((x) => x.path.endsWith('/api/score') && x.body)
    expect(posts.at(-1)!.body).toMatchObject({ streak: 5 })
  })
  it('a 401 signs the device out so the gate shows again', async () => {
    localStorage.clear()
    const api = fakeApi()
    const c = createLeaderboardClient({ fetch: api.fetchFn })
    await c.register('a@b.co', 'Al')
    api.setScoreStatus(401)
    expect(await c.submitScore(score)).toMatchObject({ ok: false, reason: 'signed_out' })
    expect(c.identity()).toBeNull()
  })
  it('works without storage at all', async () => {
    const api = fakeApi()
    const c = createLeaderboardClient({ fetch: api.fetchFn, storage: null })
    expect((await c.register('a@b.co', 'Al')).ok).toBe(true)
    expect(c.identity()).toBeNull() // nothing persisted, no crash
  })
  it('steps days as calendar arithmetic across month and year ends', () => {
    expect(addDays('2026-09-10', -1)).toBe('2026-09-09')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('junk', 1)).toBe('junk')
  })
  it('formats the board day as a calendar date', () => {
    expect(formatDay('2026-09-09')).toBe('September 9th')
    expect(formatDay('2026-01-01')).toBe('January 1st')
    expect(formatDay('2026-02-02')).toBe('February 2nd')
    expect(formatDay('2026-03-03')).toBe('March 3rd')
    expect(formatDay('2026-11-11')).toBe('November 11th')
    expect(formatDay('2026-12-22')).toBe('December 22nd')
    expect(formatDay('junk')).toBe('junk')
  })
})

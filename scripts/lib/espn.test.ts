import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EspnClient, idFromRef, NotFound } from './espn'

const SAMPLES = path.resolve(import.meta.dirname, '../../samples')
const sample = (name: string) =>
  existsSync(path.join(SAMPLES, name))
    ? (JSON.parse(readFileSync(path.join(SAMPLES, name), 'utf8')) as unknown)
    : null

/** A client whose GET is served from a map of pathname → document (or NotFound). */
function stubClient(docs: Record<string, unknown>) {
  const c = new EspnClient({ cacheDir: '/nonexistent' })
  c.get = async <T>(p: string): Promise<T> => {
    if (!(p in docs)) throw new NotFound(p)
    return docs[p] as T
  }
  return c
}

describe('idFromRef', () => {
  it('extracts the trailing numeric id from a ref URL with query string', () => {
    expect(
      idFromRef(
        'http://x/v2/sports/football/leagues/nfl/seasons/2010/athletes/5536?lang=en&region=us',
      ),
    ).toBe('5536')
  })
  it('rejects refs that do not end in a number', () => {
    expect(() => idFromRef('http://x/athletes/')).toThrow()
  })
})

describe('EspnClient against observed samples', () => {
  const leaders = sample('espn_leaders.json')
  const athlete = sample('espn_athlete.json')
  const noHeadshot = sample('espn_athlete_no_headshot.json')
  const depth = sample('espn_depthchart.json')

  it.skipIf(!leaders)('parses every passer in ESPN order for 2010 PIT', async () => {
    const c = stubClient({ '/seasons/2010/types/2/teams/23/leaders': leaders })
    const passers = await c.passers(2010, '23')
    expect(passers[0]).toEqual({ athleteId: '5536', passingYards: 3200, order: 0 })
    expect(passers.length).toBeGreaterThanOrEqual(3)
    expect(passers.map((p) => p.order)).toEqual(passers.map((_, i) => i))
    for (let i = 1; i < passers.length; i++)
      expect(passers[i]!.passingYards).toBeLessThanOrEqual(passers[i - 1]!.passingYards)
  })

  it('returns no passers for a team-season ESPN does not have', async () => {
    const c = stubClient({})
    expect(await c.passers(2000, '34')).toEqual([])
  })

  it.skipIf(!athlete || !noHeadshot)(
    'normalizes athletes with and without a headshot',
    async () => {
      const c = stubClient({ '/athletes/5536': athlete, '/athletes/22': noHeadshot })
      expect(await c.athlete('5536')).toMatchObject({
        id: '5536',
        displayName: 'Ben Roethlisberger',
        position: 'QB',
        headshotUrl: 'https://a.espncdn.com/i/headshots/nfl/players/full/5536.png',
      })
      expect((await c.athlete('22')).headshotUrl).toBeNull()
    },
  )

  it.skipIf(!depth)('reads the ranked QB depth chart, starter first', async () => {
    const c = stubClient({ '/seasons/2026/teams/23/depthcharts': depth })
    const qbs = await c.depthChartQbs(2026, '23')
    expect(qbs.length).toBeGreaterThanOrEqual(2)
    expect(qbs[0]!.rank).toBe(1)
    expect(qbs.map((q) => q.rank)).toEqual([...qbs.map((q) => q.rank)].sort((a, b) => a - b))
  })
})

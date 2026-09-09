/**
 * Integration check on the real content in /content. Skipped until the first
 * pull has run. Anything asserted here is also enforced by build:content; the
 * test exists so `npm test` catches a bad content edit without a rebuild.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../src/game/config'
import { buildBundle } from './lib/build'
import { parseContent } from './lib/content'

const CONTENT = path.resolve(import.meta.dirname, '../content')
const present = ['teams.csv', 'people.csv', 'stints.csv'].every((f) =>
  existsSync(path.join(CONTENT, f)),
)

const read = (f: string) => readFileSync(path.join(CONTENT, f), 'utf8')
const files = present
  ? { teams: read('teams.csv'), people: read('people.csv'), stints: read('stints.csv') }
  : { teams: '', people: '', stints: '' }
const { content, errors } = parseContent(files)
const { bundle, report } = buildBundle(content, {
  firstSeason: GAME_CONFIG.firstSeason,
  roles: GAME_CONFIG.roles,
  requirePhoto: false,
  sources: Object.values(files),
})

describe.skipIf(!present)('real content', () => {
  it('validates', () => expect(errors).toEqual([]))
  it('has no hard failures', () => expect(report.hardFailures).toEqual([]))
  it('covers 32 teams', () => expect(bundle.teams).toHaveLength(32))
  it('every combo has one answer, ≥2 distractors, alumni ⊆ distractors, and no self-reference', () => {
    for (const c of bundle.combos) {
      expect(bundle.people[c.answer]).toBeDefined()
      expect(c.distractors.length).toBeGreaterThanOrEqual(2)
      expect(c.distractors).not.toContain(c.answer)
      expect(new Set(c.distractors).size).toBe(c.distractors.length)
      for (const a of c.alumni) expect(c.distractors).toContain(a)
    }
  })
  it('no distractor threw for the rolled team that season', () => {
    const passers = new Map<string, Set<string>>()
    for (const s of content.stints) {
      const k = `${s.season}:${s.team_id}`
      passers.set(k, (passers.get(k) ?? new Set()).add(s.espn_id))
    }
    for (const c of bundle.combos)
      for (const d of c.distractors)
        expect(passers.get(`${c.season}:${c.team}`)!.has(d)).toBe(false)
  })
  it('one combo per (season, team) and the Texans start in 2002', () => {
    const keys = bundle.combos.map((c) => `${c.season}:${c.team}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      keys
        .filter((k) => k.endsWith(':HOU'))
        .map((k) => Number(k.split(':')[0]))
        .sort()[0],
    ).toBe(2002)
  })
})

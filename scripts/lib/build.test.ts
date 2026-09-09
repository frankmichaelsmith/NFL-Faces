import { describe, expect, it } from 'vitest'
import { buildBundle } from './build'
import type { Content, PersonRow, StintRow } from './content'

const person = (espn_id: string, name: string, extra: Partial<PersonRow> = {}): PersonRow => ({
  espn_id,
  person_id: name.toLowerCase().replace(/ /g, '-'),
  display_name: name,
  included: true,
  espn_headshot: true,
  photo_source: '',
  photo_license: '',
  photo_crop: '',
  photo_approved: false,
  notes: '',
  ...extra,
})
const stint = (
  season: number,
  team_id: string,
  espn_id: string,
  yards: number | null,
  extra: Partial<StintRow> = {},
): StintRow => ({
  season,
  team_id,
  espn_id,
  role: 'QB',
  passing_yards: yards,
  espn_order: 0,
  starter: false,
  source: 'leaders',
  ...extra,
})

/**
 * Three teams, seasons 2010–2011 complete, 2012 live.
 * A: Brady leads 2010 and 2011; Cassel is a backup in 2010 only. 2012 depth chart: Brady starter.
 * B: Cassel leads 2010; Flacco leads 2011; 2012 depth chart: Flacco starter, Cassel backup.
 * C: Ryan leads every season; Cassel threw a few passes for C in 2011.
 */
function fixture(): Content {
  return {
    teams: [
      { team_id: 'A', espn_id: '1', label: 'Alphas', location: 'A', active_from: 2010 },
      { team_id: 'B', espn_id: '2', label: 'Betas', location: 'B', active_from: 2010 },
      { team_id: 'C', espn_id: '3', label: 'Gammas', location: 'C', active_from: 2010 },
    ],
    people: [
      person('10', 'Tom Brady'),
      person('11', 'Matt Cassel'),
      person('12', 'Joe Flacco'),
      person('13', 'Matt Ryan'),
    ],
    stints: [
      stint(2010, 'A', '10', 3900),
      stint(2010, 'A', '11', 200, { espn_order: 1 }),
      stint(2010, 'B', '11', 3100),
      stint(2010, 'C', '13', 3700),
      stint(2011, 'A', '10', 5200),
      stint(2011, 'B', '12', 3600),
      stint(2011, 'C', '13', 4100),
      stint(2011, 'C', '11', 50, { espn_order: 1 }),
      stint(2012, 'A', '10', null, { starter: true, source: 'depthchart', espn_order: 101 }),
      stint(2012, 'B', '12', null, { starter: true, source: 'depthchart', espn_order: 101 }),
      stint(2012, 'B', '11', null, { source: 'depthchart', espn_order: 102 }),
      stint(2012, 'C', '13', null, { starter: true, source: 'depthchart', espn_order: 101 }),
    ],
  }
}
const opts = {
  firstSeason: 2010,
  roles: ['QB'],
  requirePhoto: false,
  sources: ['x'],
  now: new Date('2026-09-09T00:00:00Z'),
}
const combo = (b: ReturnType<typeof buildBundle>['bundle'], key: string) =>
  b.combos.find((c) => `${c.season}:${c.team}` === key)!

describe('buildBundle', () => {
  it('picks the passing-yards leader as the single answer and excludes same-season passers of that team', () => {
    const { bundle, report } = buildBundle(fixture(), opts)
    // Cassel threw for A in 2010, so he cannot be a wrong face there even though he led B.
    // That leaves only Ryan → thin → not emitted.
    expect(report.thinCombos).toEqual([{ combo: '2010:A:QB', distractors: 1 }])
    expect(bundle.combos.map((c) => `${c.season}:${c.team}`)).not.toContain('2010:A')
    // Without that backup stint, Cassel is a legal distractor and the combo is answerable.
    const c = fixture()
    c.stints = c.stints.filter(
      (s) => !(s.season === 2010 && s.team_id === 'A' && s.espn_id === '11'),
    )
    const { bundle: b2 } = buildBundle(c, opts)
    expect(combo(b2, '2010:A').answer).toBe('10')
    expect(combo(b2, '2010:A').distractors.sort()).toEqual(['11', '13'])
  })

  it('emits every answerable combo with ≥2 distractors and flags thin ones as hard failures', () => {
    const { bundle, report } = buildBundle(fixture(), opts)
    expect(report.thinCombos).toEqual([{ combo: '2010:A:QB', distractors: 1 }])
    expect(report.hardFailures).toEqual(['2010:A:QB has only 1 distractor(s)'])
    expect(bundle.combos.map((c) => `${c.season}:${c.team}`)).toEqual([
      '2010:B',
      '2010:C',
      '2011:A',
      '2011:B',
      '2011:C',
      '2012:A',
      '2012:B',
      '2012:C',
    ])
  })

  it('uses the depth-chart starter for the live season and excludes listed backups', () => {
    const { bundle } = buildBundle(fixture(), opts)
    expect(bundle.liveSeason).toBe(2012)
    const b2012 = combo(bundle, '2012:B')
    expect(b2012.answer).toBe('12')
    // Cassel is on B's 2012 depth chart, so he is not a distractor for B even though he is nobody's answer in 2012 anyway.
    expect(b2012.distractors.sort()).toEqual(['10', '13'])
  })

  it("computes alumni as distractors who were this team's answer in another season", () => {
    const { bundle } = buildBundle(fixture(), opts)
    // B 2011: answer Flacco; distractors Brady (A) and Ryan (C). Cassel led B in 2010 but is not a 2011 answer anywhere.
    const b2011 = combo(bundle, '2011:B')
    expect(b2011.distractors.sort()).toEqual(['10', '13'])
    expect(b2011.alumni).toEqual([])
    // B 2010: answer Cassel; distractors Brady, Ryan; Flacco is not a 2010 answer. No alumni either.
    expect(combo(bundle, '2010:B').alumni).toEqual([])
    // B 2012: answer Flacco; distractors Brady, Ryan. Still no alumni. Now make Ryan an ex-B by adding a season.
    const c = fixture()
    c.stints.push(
      stint(2013, 'B', '13', 4000),
      stint(2013, 'A', '10', 4000),
      stint(2013, 'C', '12', 4000),
    )
    const { bundle: b2 } = buildBundle(c, opts)
    expect(combo(b2, '2011:B').alumni).toEqual(['13'])
    expect(combo(b2, '2013:B').alumni).toEqual(['12'])
  })

  it('breaks passing-yards ties by ESPN order and reports them', () => {
    const c = fixture()
    c.stints.push(stint(2011, 'A', '11', 5200, { espn_order: 1 }))
    const { bundle, report } = buildBundle(c, opts)
    expect(combo(bundle, '2011:A').answer).toBe('10')
    expect(report.ties).toEqual([{ combo: '2011:A:QB', names: ['Tom Brady', 'Matt Cassel'] }])
  })

  it('drops combos whose answer is excluded by curation, and removes them from distractor pools', () => {
    const c = fixture()
    c.people.find((p) => p.espn_id === '13')!.included = false
    const { bundle, report } = buildBundle(c, opts)
    expect(report.droppedCombos.map((d) => d.combo)).toEqual([
      '2010:C:QB',
      '2011:C:QB',
      '2012:C:QB',
    ])
    for (const combo of bundle.combos) expect(combo.distractors).not.toContain('13')
  })

  it('with requirePhoto, only people with an approved photo count', () => {
    const c = fixture()
    for (const p of c.people) {
      p.photo_source = 'espn'
      p.photo_approved = p.espn_id !== '12'
    }
    const { bundle, report } = buildBundle(c, { ...opts, requirePhoto: true })
    expect(report.droppedCombos.map((d) => d.combo)).toEqual(['2011:B:QB', '2012:B:QB'])
    expect(bundle.people['12']).toBeUndefined()
    expect(bundle.people['10']).toEqual({ name: 'Tom Brady', photo: '10.jpg' })
  })

  it('lists answers without a photo as the curator to-do list, most combos first', () => {
    const { report } = buildBundle(fixture(), opts)
    expect(report.missingPhotos.map((m) => [m.name, m.combos])).toEqual([
      ['Matt Ryan', 3],
      ['Tom Brady', 3],
      ['Joe Flacco', 2],
      ['Matt Cassel', 1],
    ])
  })

  it('hashes sources and options into buildHash deterministically', () => {
    const a = buildBundle(fixture(), opts).bundle.buildHash
    const b = buildBundle(fixture(), opts).bundle.buildHash
    const c = buildBundle(fixture(), { ...opts, sources: ['y'] }).bundle.buildHash
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toHaveLength(12)
  })
})

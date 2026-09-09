import { describe, expect, it } from 'vitest'
import {
  buildProBowl,
  parseProBowlContent,
  type DraftTeamRow,
  type PlayerRow,
  type SelectionRow,
} from './probowl'

const team = (abbr: string, label: string, name: string): DraftTeamRow => ({
  abbr,
  label,
  name,
  color: '000000',
  alt_color: 'FFFFFF',
  first_season: null,
  last_season: null,
  notes: '',
})
const player = (
  espn_id: string,
  name: string,
  pos: PlayerRow['pos'],
  extra: Partial<PlayerRow> = {},
): PlayerRow => ({
  espn_id,
  name,
  pos,
  jersey: 10,
  jersey_source: 'espn',
  college_id: 'c1',
  college_name: 'State',
  college_logo: 'x',
  college_source: 'espn',
  draft_status: 'drafted',
  draft_year: 2000,
  draft_round: 1,
  draft_pick: 1,
  draft_team: 'PIT',
  draft_team_name: 'Pittsburgh Steelers',
  draft_source: 'espn',
  included: true,
  notes: '',
  ...extra,
})
const sel = (
  season: number,
  pos: SelectionRow['pos'],
  name: string,
  espn_id: string,
  number: number | null = null,
): SelectionRow => ({
  season,
  pos,
  number,
  wiki_title: name,
  name,
  team: 'X',
  espn_id,
  note: '',
})

function fixture() {
  return {
    draftTeams: [
      team('PIT', 'PIT', 'Pittsburgh Steelers'),
      team('LAR', 'LA', 'Los Angeles Rams'),
      team('LARD', 'LA', 'Los Angeles Raiders'),
      team('KC', 'KC', 'Kansas City Chiefs'),
    ],
    players: [
      player('1', 'Ben', 'QB', { jersey: 7, college_id: 'c1', draft_team: 'PIT' }),
      player('2', 'Aaron', 'QB', {
        jersey: 12,
        college_id: 'c2',
        college_name: 'Cal',
        draft_team: 'KC',
      }),
      player('3', 'Kurt', 'QB', {
        jersey: 13,
        college_id: 'c3',
        college_name: 'UNI',
        draft_status: 'undrafted',
        draft_team: '',
        draft_team_name: '',
      }),
      player('4', 'Marshall', 'RB', {
        jersey: 28,
        college_id: 'c4',
        college_name: 'SDSU',
        draft_team: 'LAR',
      }),
      player('5', 'Bo', 'RB', { jersey: 34, college_id: 'c1', draft_team: 'LARD' }),
      player('7', 'Ricky', 'RB', { jersey: 21, college_id: 'c1', draft_team: 'KC' }),
      player('6', 'Rob', 'TE', {
        jersey: null,
        college_id: '',
        college_name: '',
        college_logo: '',
        draft_status: 'unknown',
        draft_team: '',
      }),
    ],
    selections: [
      sel(2000, 'QB', 'Ben', '1', 7),
      sel(2000, 'QB', 'Aaron', '2', 12),
      sel(2000, 'QB', 'Kurt', '3', 13),
      sel(2000, 'RB', 'Marshall', '4', 28),
      sel(2001, 'RB', 'Bo', '5', 34),
      sel(2001, 'TE', 'Rob', '6'),
      sel(2001, 'RB', 'Ricky', '7', 21),
      sel(2001, 'QB', 'Ghost', ''),
    ],
  }
}

describe('buildProBowl', () => {
  it('builds rosters, players, colleges and tiles from resolved selections', () => {
    const { section, report } = buildProBowl(fixture())
    expect(section.seasons).toEqual([2000, 2001])
    expect(section.rosters['2000']).toEqual(['1', '2', '3', '4'])
    expect(section.rosters['2001']).toEqual(['5', '6', '7'])
    expect(Object.keys(section.players)).toHaveLength(7)
    expect(section.players['3']).toMatchObject({ draft: 'UDFA', college: 'c3', jersey: 13 })
    expect(section.players['6']).toMatchObject({ draft: null, college: null, jersey: null })
    expect(section.colleges['c2']).toEqual({ name: 'Cal', logo: 'c2.png' })
    expect(Object.keys(section.teams).sort()).toEqual(['KC', 'LAR', 'LARD', 'PIT'])
    expect(section.teams['LARD']).toMatchObject({ label: 'LA', name: 'Los Angeles Raiders' })
    expect(report.unresolved).toEqual([{ season: 2001, name: 'Ghost', note: '' }])
    expect(report.missing).toEqual({ college: ['Rob'], jersey: ['Rob'], draft: ['Rob'] })
    expect(section.numbers['2000']).toEqual({ '1': 7, '2': 12, '3': 13, '4': 28 })
  })

  it('uses the number worn that season, not the last-worn number', () => {
    const f = fixture()
    // Ben wore 7 in 2000 but ESPN says his last number was 10; a 2001 selection says 81.
    f.players.find((p) => p.espn_id === '1')!.jersey = 10
    f.selections.push(sel(2001, 'QB', 'Ben', '1', 81))
    const { section } = buildProBowl(f)
    const n2000 = section.combos.find(
      (c) => c.player === '1' && c.season === 2000 && c.category === 'number',
    )!
    const n2001 = section.combos.find(
      (c) => c.player === '1' && c.season === 2001 && c.category === 'number',
    )!
    expect(n2000.answer).toBe('7')
    expect(n2001.answer).toBe('81')
    expect(n2001.distractors).not.toContain('81')
    expect(n2000.distractors).not.toContain('7')
  })

  it('emits one combo per attribute a player has, with pools drawn from the whole roster', () => {
    const { section } = buildProBowl(fixture())
    const of = (player: string, category: string) =>
      section.combos.find((c) => c.player === player && c.category === category)!
    expect(of('1', 'alma')).toMatchObject({ answer: 'c1' })
    expect(of('1', 'alma').distractors.sort()).toEqual(['c2', 'c3', 'c4'])
    expect(of('3', 'draft')).toMatchObject({ answer: 'UDFA' })
    expect(of('3', 'draft').distractors.sort()).toEqual(['KC', 'LAR', 'LARD', 'PIT'])
    expect(of('1', 'draft').distractors).toContain('UDFA')
    // numbers come from other players at the same position
    expect(of('1', 'number')).toMatchObject({ answer: '7' })
    expect(of('1', 'number').distractors.sort()).toEqual(['12', '13'])
    expect(of('4', 'number').distractors.sort()).toEqual(['21', '34'])
    expect(of('1', 'position').distractors).toEqual(['RB', 'WR', 'TE'])
    // Rob has no college, jersey or draft team: only the position combo
    expect(section.combos.filter((c) => c.player === '6').map((c) => c.category)).toEqual([
      'position',
    ])
  })

  it('never offers a distractor tile that reads the same as the answer tile', () => {
    const { section } = buildProBowl(fixture())
    const rams = section.combos.find((c) => c.player === '4' && c.category === 'draft')!
    expect(rams.answer).toBe('LAR')
    expect(rams.distractors).not.toContain('LARD')
    expect(rams.distractors).toContain('PIT')
  })

  it('reports a hard failure when a combo would have fewer than two distractors', () => {
    const f = fixture()
    f.players = f.players.filter((p) => p.pos !== 'QB' || p.espn_id === '1')
    f.selections = f.selections.filter((s) => !['2', '3'].includes(s.espn_id))
    const { report } = buildProBowl(f)
    expect(report.hardFailures.some((h) => h.includes('Ben number'))).toBe(true)
  })

  it('excluded players drop out of rosters and pools', () => {
    const f = fixture()
    f.players.find((p) => p.espn_id === '2')!.included = false
    const { section, report } = buildProBowl(f)
    expect(section.rosters['2000']).not.toContain('2')
    expect(section.colleges['c2']).toBeUndefined()
    expect(report.unresolved.map((u) => u.name)).toContain('Aaron')
  })
})

describe('parseProBowlContent', () => {
  it('validates types and cross-file references with line numbers', () => {
    const { errors } = parseProBowlContent({
      selections:
        'season,pos,wiki_title,name,team,espn_id,note\n2000,QB,Ben,Ben,PIT,1,\nabc,LB,Ghost,Ghost,X,,\n',
      players:
        'espn_id,name,pos,jersey,jersey_source,college_id,college_name,college_logo,college_source,draft_status,draft_year,draft_round,draft_pick,draft_team,draft_team_name,draft_source,included,notes\n' +
        '1,Ben,QB,7,espn,c1,State,x,espn,drafted,2004,1,11,ZZZ,Nowhere,espn,true,\n',
      draftTeams:
        'abbr,label,name,color,alt_color,first_season,last_season,notes\nPIT,PIT,Pittsburgh Steelers,000000,FFB612,1933,,\n',
    })
    expect(errors).toContain('probowl_selections.csv:3: season must be an integer')
    expect(errors).toContain('probowl_selections.csv:3: pos must be one of QB/RB/WR/TE')
    expect(errors).toContain('probowl_selections.csv:3: number must be an integer or empty')
    expect(errors).toContain('probowl_players.csv: Ben drafted by unknown team key "ZZZ"')
  })
})

import { describe, expect, it } from 'vitest'
import { nflTeamSeasonTitles, parseNflRosterNumbers } from './nfl-rosters'

describe('NFL team-season titles', () => {
  it('follows the franchise names of each era', () => {
    expect(nflTeamSeasonTitles(1996)).toContain('1996 Houston Oilers season')
    expect(nflTeamSeasonTitles(1996)).not.toContain('1996 Cleveland Browns season')
    expect(nflTeamSeasonTitles(1998)).toContain('1998 Tennessee Oilers season')
    expect(nflTeamSeasonTitles(2004)).toContain('2004 St. Louis Rams season')
    expect(nflTeamSeasonTitles(2004)).toContain('2004 Houston Texans season')
    expect(nflTeamSeasonTitles(2021)).toContain('2021 Washington Football Team season')
    expect(nflTeamSeasonTitles(2023)).toHaveLength(32)
    expect(nflTeamSeasonTitles(1997)).toHaveLength(30)
  })
})

describe('parseNflRosterNumbers', () => {
  it('reads {{NFLplayer}} rows, folding nbsp padding and names', () => {
    const rows = parseNflRosterNumbers(`{{NFL final roster
|Quarterbacks=
{{NFLplayer|18|Peyton Manning}}
{{NFLplayer|&nbsp;7|Curtis Painter}}
|Running Backs=
{{NFLplayer|31|Donald Brown|d=running back}}
{{NFLplayer|85|Pierre Garçon}}
{{NFLplayer||No Number}}
}}`)
    expect(rows.map((r) => `${r.name}:${r.number}`)).toEqual([
      'Peyton Manning:18',
      'Curtis Painter:7',
      'Donald Brown:31',
      'Pierre Garçon:85',
    ])
    expect(rows[3]!.key).toBe('pierre garcon')
  })
})

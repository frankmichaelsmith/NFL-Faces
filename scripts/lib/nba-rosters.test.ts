import { describe, expect, it } from 'vitest'
import { parseRosterNumbers, seasonSlug, teamSeasonTitles } from './nba-rosters'

describe('team-season page titles', () => {
  it('names seasons the way Wikipedia does and knows the franchise eras', () => {
    expect(seasonSlug(2004)).toBe('2003–04')
    expect(seasonSlug(2000)).toBe('1999–2000')
    const t2004 = teamSeasonTitles(2004)
    expect(t2004).toContain('2003–04 Los Angeles Lakers season')
    expect(t2004).toContain('2003–04 Seattle SuperSonics season')
    expect(t2004).toContain('2003–04 New Orleans Hornets season')
    expect(t2004).not.toContain('2003–04 Charlotte Bobcats season')
    expect(t2004).toHaveLength(29)
    const t1996 = teamSeasonTitles(1996)
    expect(t1996).toContain('1995–96 Vancouver Grizzlies season')
    expect(t1996).toContain('1995–96 Washington Bullets season')
    expect(t1996).toContain('1995–96 Charlotte Hornets season')
    expect(t1996).toHaveLength(29)
    expect(teamSeasonTitles(2025)).toHaveLength(30)
    expect(teamSeasonTitles(2007)).toContain('2006–07 New Orleans/Oklahoma City Hornets season')
  })
})

describe('parseRosterNumbers', () => {
  it('reads {{player2}} rows with numbers, names folded for matching', () => {
    const rows = parseRosterNumbers(`{{NBA roster header|team=Los Angeles Lakers|season=2003–04}}
{{player2 | num = 8 | first = Kobe | last = Bryant | pos = G | ft = 6 | in = 6 | lbs = 205 | DOB = 1978-08-23 | school = [[Lower Merion High School|Lower Merion HS (PA)]] }}
{{player2 | num = 34 | first = Shaquille | last = O'Neal | pos = C | college = LSU }}
{{player2 | num = 7 | first = Toni | last = Kukoč | pos = F | from = Croatia}}
{{player2 | num = 00 | first = Robert | last = Parish | pos = C }}
{{player | num = 20 | first = Gary | last = Payton | pos = G }}
{{player2 | num = 45, 23 | first = Michael | last = Jordan | pos = G }}
{{player2 | first = No | last = Number }}
{{NBA roster footer}}`)
    expect(rows.map((r) => `${r.name}:${r.number}`)).toEqual([
      'Kobe Bryant:8',
      "Shaquille O'Neal:34",
      'Toni Kukoč:7',
      'Robert Parish:0',
      'Gary Payton:20',
      'Michael Jordan:45',
      'Michael Jordan:23',
    ])
    expect(rows[1]!.key).toBe('shaquille oneal')
    expect(rows[2]!.key).toBe('toni kukoc')
  })
})

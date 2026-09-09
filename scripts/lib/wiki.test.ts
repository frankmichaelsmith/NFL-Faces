import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  nameKey,
  normalizeName,
  parseDraftPage,
  parseInfobox,
  parseProBowlRoster,
  proBowlTitles,
} from './wiki'

const sample = (f: string) =>
  readFileSync(path.resolve(import.meta.dirname, '../../samples', f), 'utf8')

describe('parseProBowlRoster', () => {
  it('reads the table format: number, bold name, team, replacements and injuries included', () => {
    const r = parseProBowlRoster(sample('wiki_probowl_2002.txt'))
    const names = r.map((e) => `${e.pos} ${e.name}`)
    expect(names).toContain('QB Rich Gannon')
    expect(names).toContain('QB Tom Brady')
    expect(names).toContain('RB Corey Dillon') // replacement
    expect(names).toContain('RB Jerome Bettis') // injury withdrawal
    expect(names).toContain('WR Rod Smith')
    expect(r.find((e) => e.name === 'Rod Smith')!.wikiTitle).toBe('Rod Smith (wide receiver)')
    expect(r.find((e) => e.name === 'Tom Brady')!.number).toBe(12)
    expect(r.find((e) => e.name === 'Rich Gannon')!.number).toBe(12)
    expect(names.some((n) => n.startsWith('FB') || n.includes('Larry Centers'))).toBe(false)
    expect(r.filter((e) => e.pos === 'QB').length).toBeGreaterThanOrEqual(3)
  })
  it('reads the 2014-style list format with {{NFLplayer}} bullets', () => {
    const r = parseProBowlRoster(sample('wiki_probowl_2014.txt'))
    const names = r.map((e) => `${e.pos} ${e.name}`)
    expect(names).toContain('QB Cam Newton')
    expect(names).toContain('QB Nick Foles')
    expect(r.find((e) => e.name === 'Cam Newton')!.number).toBe(1)
    expect(r.filter((e) => e.pos === 'RB').length).toBeGreaterThan(0)
    expect(r.filter((e) => e.pos === 'WR').length).toBeGreaterThan(0)
    expect(new Set(r.map((e) => `${e.pos}:${e.wikiTitle}`)).size).toBe(r.length)
  })
  it("reads the 1997-page list format ('''QB''' headings, bold starters, no numbers)", () => {
    const r = parseProBowlRoster(sample('wiki_probowl_1996.txt'))
    const names = r.map((e) => `${e.pos} ${e.name}`)
    expect(names).toContain('QB Drew Bledsoe') // bold starter
    expect(names).toContain('QB Mark Brunell')
    expect(names).toContain('QB Brett Favre') // NFC side
    expect(names).toContain('RB Jerome Bettis')
    expect(names).toContain('TE Shannon Sharpe')
    expect(names).not.toContain('RB Kimble Anders') // listed under FB, not RB
    expect(r.find((e) => e.name === 'Drew Bledsoe')).toMatchObject({
      number: null,
      team: 'New England',
    })
    expect(r.filter((e) => e.pos === 'WR').length).toBeGreaterThanOrEqual(6)
    expect(new Set(r.map((e) => `${e.pos}:${e.wikiTitle}`)).size).toBe(r.length)
  })
  it('reads the 1998-page heading format (===Quarterbacks=== with bullets, no numbers)', () => {
    const r = parseProBowlRoster(sample('wiki_probowl_1997.txt'))
    const names = r.map((e) => `${e.pos} ${e.name}`)
    expect(names).toContain('QB John Elway')
    expect(names).toContain('QB Brett Favre')
    expect(names).toContain('RB Terrell Davis')
    expect(names).toContain('WR Tim Brown')
    expect(names).toContain('TE Shannon Sharpe')
    expect(r.find((e) => e.name === 'Tim Brown')).toMatchObject({
      wikiTitle: 'Tim Brown (American football)',
      number: null,
      team: 'Oakland Raiders',
    })
    // a parenthetical role note is not part of the team
    expect(r.find((e) => e.name === 'Eric Metcalf')!.team).toBe('San Diego Chargers')
    expect(r.filter((e) => e.pos === 'QB').length).toBeGreaterThanOrEqual(6)
  })
  it('knows the Pro Bowl for a season is played the following January', () => {
    expect(proBowlTitles(2022)).toEqual(['2023 Pro Bowl Games', '2023 Pro Bowl'])
  })
})

describe('parseDraftPage', () => {
  it('reads {{NFLDraft-row}} templates with spaces around the pipes', () => {
    const rows = parseDraftPage(sample('wiki_draft_1994.txt'))
    const faulk = rows.find((r) => r.last === 'Faulk')!
    expect(faulk).toMatchObject({
      year: 1994,
      round: 1,
      pick: 2,
      team: 'Indianapolis Colts',
      first: 'Marshall',
      undrafted: false,
    })
    expect(rows.length).toBeGreaterThan(10)
  })
  it('flags undrafted rows', () => {
    const rows = parseDraftPage(
      '{{NFLDraft-row|draftyear=2010 |undrafted=yes |team=Dallas Cowboys|first=Chris|last=Gronkowski|position=Fullback|college=University of Arizona}}',
    )
    expect(rows[0]).toMatchObject({ undrafted: true, round: null, team: 'Dallas Cowboys' })
  })
})

describe('parseInfobox', () => {
  it('reads number, college, draft fields from a player article', () => {
    const f = parseInfobox(sample('wiki_infobox_gronkowski.txt'))
    expect(f.number).toBe(87)
    expect(f.college).toBe('Arizona')
    expect(f.draftYear).toBe(2010)
    expect(f.draftRound).toBe(2)
    expect(f.draftPick).toBe(42)
    expect(f.undraftedYear).toBeNull()
    expect(f.numbers).toEqual([87])
    expect(f.colleges).toEqual([{ name: 'Arizona', link: 'Arizona Wildcats football' }])
  })
  it('keeps every number and every college, and treats the last college as the one that counts', () => {
    const f = parseInfobox(sample('wiki_infobox_cunningham.txt'))
    expect(f.numbers).toEqual([12, 7, 1])
    expect(f.number).toBe(12)
    expect(f.college).toBe('UNLV')
    expect(f.colleges[0]).toEqual({ name: 'UNLV', link: 'UNLV Rebels football' })
    expect(
      parseInfobox(
        '| college = [[Notre Dame Fighting Irish football|Notre Dame]] (1989)<br>[[Florida Gators football|Florida]] (1990–1992)\n',
      ).college,
    ).toBe('Florida')
    expect(parseInfobox('| college = Hutchinson CC<br>[[Kansas State]]\n').colleges).toEqual([
      { name: 'Hutchinson CC', link: null },
      { name: 'Kansas State', link: 'Kansas State' },
    ])
    // bulleted list over several lines (Jayden Daniels), basketball links (Antonio Gates), {{ubl}}
    const daniels = parseInfobox(
      '| number = 5\n| college = \n* [[Arizona State Sun Devils football|Arizona State]] (2019–2021)\n* [[LSU Tigers football|LSU]] (2022–2023)\n| draftyear = 2024\n',
    )
    expect(daniels.colleges.map((c) => c.name)).toEqual(['Arizona State', 'LSU'])
    expect(daniels.college).toBe('LSU')
    expect(daniels.draftYear).toBe(2024)
    expect(
      parseInfobox(
        "| college = *[[Eastern Michigan Eagles men's basketball|Eastern Michigan]] (1999–2000)\n*[[Kent State Golden Flashes men's basketball|Kent State]] (2001–2003)\n}}",
      ).college,
    ).toBe('Kent State')
    expect(
      parseInfobox(
        '| college = {{ubl|[[Baylor Bears football|Baylor]] (2009)|[[Utah Utes football|Utah]] (2011)}}\n',
      ).colleges.map((c) => c.link),
    ).toEqual(['Baylor Bears football', 'Utah Utes football'])
    // citations and templates in the number field are not numbers
    expect(
      parseInfobox(
        '| number = 22, 2, 20, 7<ref name="Pfa">{{cite web | url=https://example.com/f/flut00400.html#gsc.tab=0 | accessdate=14 March 2026}}</ref>\n',
      ).numbers,
    ).toEqual([22, 2, 20, 7])
    expect(
      parseInfobox(
        '| number = 13<ref>{{cite web|url=https://x.com/1462537005724840000|title=Dan Marino 345}}</ref>\n',
      ).numbers,
    ).toEqual([13])
  })
  it('reads only the infobox, not a number= or college= in a later template', () => {
    const marino = parseInfobox(
      '{{Infobox NFL biography\n| name = Dan Marino\n| position = [[Quarterback]]\n| college = [[Pittsburgh Panthers football|Pittsburgh]] (1979–1982)\n}}\nBody text.\n{{cite web | number = 8, 3, 25 | college = Nowhere}}\n',
    )
    expect(marino.numbers).toEqual([])
    expect(marino.college).toBe('Pittsburgh')
    expect(marino.position).toBe('Quarterback')
  })
})

describe('name matching', () => {
  it('folds spaced initials and strips suffixes and accents', () => {
    expect(normalizeName('A. J. Green')).toBe('A.J. Green')
    expect(nameKey('A. J. Green')).toBe(nameKey('A.J. Green'))
    expect(nameKey('Melvin Gordon III')).toBe(nameKey('Melvin Gordon'))
    expect(nameKey('Chris Godwin Jr.')).toBe('chris godwin')
    expect(nameKey('José Ramírez')).toBe('jose ramirez')
  })
})

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
    expect(names.some((n) => n.startsWith('FB') || n.includes('Larry Centers'))).toBe(false)
    expect(r.filter((e) => e.pos === 'QB').length).toBeGreaterThanOrEqual(3)
  })
  it('reads the 2014-style list format with {{NFLplayer}} bullets', () => {
    const r = parseProBowlRoster(sample('wiki_probowl_2014.txt'))
    const names = r.map((e) => `${e.pos} ${e.name}`)
    expect(names).toContain('QB Cam Newton')
    expect(names).toContain('QB Nick Foles')
    expect(r.filter((e) => e.pos === 'RB').length).toBeGreaterThan(0)
    expect(r.filter((e) => e.pos === 'WR').length).toBeGreaterThan(0)
    expect(new Set(r.map((e) => `${e.pos}:${e.wikiTitle}`)).size).toBe(r.length)
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

import { describe, expect, it } from 'vitest'
import { parseContent, PERSON_HEADER, STINT_HEADER, TEAM_HEADER } from './content'

const teams = `${TEAM_HEADER.join(',')}
PIT,23,Steelers,Pittsburgh,2000
HOU,34,Texans,Houston,2002
`
const people = `${PERSON_HEADER.join(',')}
5536,roethlisberger-ben,Ben Roethlisberger,true,true,,,,false,
1,carr-david,David Carr,true,false,,,,false,
`
const stints = `${STINT_HEADER.join(',')}
2010,PIT,5536,QB,3200,0,false,leaders
2002,HOU,1,QB,2592,0,false,leaders
`

describe('parseContent', () => {
  it('accepts valid content', () => {
    const { content, errors } = parseContent({ teams, people, stints })
    expect(errors).toEqual([])
    expect(content.teams).toHaveLength(2)
    expect(content.people[0]).toMatchObject({
      espn_id: '5536',
      included: true,
      espn_headshot: true,
    })
    expect(content.stints[0]).toMatchObject({
      season: 2010,
      passing_yards: 3200,
      starter: false,
      source: 'leaders',
    })
  })

  it('reports header mismatches with the file and line', () => {
    const { errors } = parseContent({ teams: 'team_id,label\nPIT,Steelers\n', people, stints })
    expect(errors[0]).toMatch(
      /^teams.csv:1: header mismatch; missing espn_id, location, active_from/,
    )
  })

  it('reports type errors with line numbers', () => {
    const bad = stints + '2011,PIT,5536,QB,lots,0,maybe,leaders\n'
    const { errors } = parseContent({ teams, people, stints: bad })
    expect(errors).toContain('stints.csv:4: passing_yards must be an integer, got "lots"')
    expect(errors).toContain('stints.csv:4: starter must be true or false, got "maybe"')
  })

  it('enforces referential integrity and team active seasons', () => {
    const bad = stints + '2001,HOU,5536,QB,100,0,false,leaders\n2010,XXX,9,QB,1,0,false,leaders\n'
    const { errors } = parseContent({ teams, people, stints: bad })
    expect(errors).toContain('stints.csv:row 3: HOU was not active in 2001 (active_from 2002)')
    expect(errors).toContain('stints.csv:row 4: unknown team_id XXX')
    expect(errors).toContain('stints.csv:row 4: unknown espn_id 9')
  })

  it('rejects duplicates, missing yards on leaders rows, and two starters', () => {
    const bad =
      stints +
      '2010,PIT,5536,QB,3200,1,false,leaders\n' +
      '2026,PIT,5536,QB,,101,true,depthchart\n' +
      '2026,PIT,1,QB,,102,true,depthchart\n' +
      '2012,PIT,1,QB,,0,false,leaders\n'
    const { errors } = parseContent({ teams, people, stints: bad })
    expect(errors).toContain('stints.csv:row 3: duplicate stint 2010:PIT:5536:QB')
    expect(errors).toContain('stints.csv: 2 starters for 2026:PIT:QB; expected 1')
    expect(errors).toContain('stints.csv:row 6: leaders rows need passing_yards')
  })

  it('rejects an approved photo without a source', () => {
    const bad = people.replace(
      '5536,roethlisberger-ben,Ben Roethlisberger,true,true,,,,false,',
      '5536,roethlisberger-ben,Ben Roethlisberger,true,true,,,,true,',
    )
    const { errors } = parseContent({ teams, people: bad, stints })
    expect(errors).toContain(
      'people.csv:row 1: Ben Roethlisberger is photo_approved but photo_source is empty',
    )
  })
})

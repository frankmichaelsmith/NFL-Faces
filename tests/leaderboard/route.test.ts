import { describe, expect, it } from 'vitest'
import { boardModeOf, boardPath } from '../../src/leaderboard/route'

describe('board routes', () => {
  it('maps paths to sports and back', () => {
    expect(boardModeOf('/leaderboard')).toBe('probowl')
    expect(boardModeOf('/leaderboard/')).toBe('probowl')
    expect(boardModeOf('/leaderboard/nfl')).toBe('probowl')
    expect(boardModeOf('/leaderboard/nba')).toBe('nba')
    expect(boardModeOf('/leaderboard/mlb')).toBeNull()
    expect(boardModeOf('/')).toBeNull()
    expect(boardPath('probowl')).toBe('/leaderboard')
    expect(boardPath('nba')).toBe('/leaderboard/nba')
  })
})

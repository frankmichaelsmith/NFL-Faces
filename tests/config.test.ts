import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../src/game/config'

describe('game config (locked decisions)', () => {
  it('has two wheels: season then team', () => {
    expect(GAME_CONFIG.wheels.map((w) => w.kind)).toEqual(['season', 'team'])
  })
  it('is quarterbacks only, from 2000, with a fixed 6 s timer', () => {
    expect(GAME_CONFIG.roles).toEqual(['QB'])
    expect(GAME_CONFIG.firstSeason).toBe(2000)
    expect(GAME_CONFIG.decisionMs).toBe(6000)
  })
  it('alumni weighting is 30% per distractor slot (Frank, 2026-09-09)', () => {
    expect(GAME_CONFIG.alumniProb).toBe(0.3)
  })
})

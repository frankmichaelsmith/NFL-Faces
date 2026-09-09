import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadStats,
  recordRound,
  recordStreakEnd,
  saveStats,
  setMute,
} from '../../src/storage/local'

describe('local stats', () => {
  beforeEach(() => localStorage.clear())

  it('starts with defaults and mints a device id that survives reloads', () => {
    const a = loadStats()
    expect(a.best_streak).toBe(0)
    expect(a.mute).toBe(true)
    expect(a.device_id).toMatch(/\S{8,}/)
    const b = loadStats()
    expect(b.device_id).toBe(a.device_id)
  })

  it('round-trips through localStorage', () => {
    let s = loadStats()
    s = recordRound(s, new Date('2026-09-09T12:00:00Z'))
    s = recordStreakEnd(s, 7, '2008 · BROWNS')
    saveStats(s)
    const back = loadStats()
    expect(back.total_rounds).toBe(1)
    expect(back.total_streaks).toBe(1)
    expect(back.best_streak).toBe(7)
    expect(back.best_streak_roll).toBe('2008 · BROWNS')
    expect(back.first_played_at).toBe('2026-09-09T12:00:00.000Z')
  })

  it('a tie does not overwrite the best-streak roll; an improvement does', () => {
    let s = recordStreakEnd(loadStats(), 5, '2010 · STEELERS')
    s = recordStreakEnd(s, 5, '2001 · RAMS')
    expect(s.best_streak_roll).toBe('2010 · STEELERS')
    s = recordStreakEnd(s, 6, '2001 · RAMS')
    expect(s.best_streak).toBe(6)
    expect(s.best_streak_roll).toBe('2001 · RAMS')
    expect(s.total_streaks).toBe(3)
  })

  it('tolerates garbage in storage and fills missing fields', () => {
    localStorage.setItem('nfl-faces:stats:v1', '{"best_streak":"nope","total_rounds":3}')
    const s = loadStats()
    expect(s.best_streak).toBe(0)
    expect(s.total_rounds).toBe(3)
    localStorage.setItem('nfl-faces:stats:v1', 'not json')
    expect(loadStats().best_streak).toBe(0)
  })

  it('keeps first_played_at from the first round only', () => {
    let s = recordRound(loadStats(), new Date('2026-01-01T00:00:00Z'))
    s = recordRound(s, new Date('2026-02-01T00:00:00Z'))
    expect(s.first_played_at).toBe('2026-01-01T00:00:00.000Z')
    expect(setMute(s, false).mute).toBe(false)
  })
})

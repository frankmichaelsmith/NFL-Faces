import { describe, expect, it } from 'vitest'
import type { Round } from '../../src/game/select'
import { createReducer, initialState, remainingMs, type GameState } from '../../src/state/machine'

const round = (answer: string, answerSlot: 0 | 1 | 2 = 1): Round => ({
  kind: 'faces',
  usedKey: answer,
  combo: { season: 2010, team: 'PIT', role: 'QB', answer, distractors: ['x', 'y'], alumni: [] },
  faces:
    answerSlot === 0
      ? [answer, 'x', 'y']
      : answerSlot === 1
        ? ['x', answer, 'y']
        : ['x', 'y', answer],
  answerSlot,
  alumniCount: 0,
})
const reduce = createReducer({ decisionMs: 5000 })

/** Walk a fresh game to AWAITING with the timer started at t=1000. */
function awaiting(r = round('ben')): GameState {
  let s = reduce(initialState, { type: 'START', round: r })
  s = reduce(s, { type: 'LANDED' })
  return reduce(s, { type: 'REVEALED', now: 1000 })
}

describe('state machine', () => {
  it('walks idle → spinning → awaiting and starts the timer only when painted', () => {
    let s = reduce(initialState, { type: 'START', round: round('ben') })
    expect(s.phase).toBe('spinning')
    expect(s.roundIndex).toBe(1)
    // taps during the spin are ignored
    expect(reduce(s, { type: 'TAP', slot: 1, now: 500 })).toBe(s)
    s = reduce(s, { type: 'LANDED' })
    expect(s.phase).toBe('awaiting')
    expect(s.revealAt).toBeNull()
    // taps before the paint are ignored too
    expect(reduce(s, { type: 'TAP', slot: 1, now: 900 })).toBe(s)
    s = reduce(s, { type: 'REVEALED', now: 1000 })
    expect(s.revealAt).toBe(1000)
    expect(remainingMs(s, 3000, 5000)).toBe(3000)
  })

  it('scores a correct tap, bumps the streak, and protects the answer from repeating', () => {
    const s = reduce(awaiting(), { type: 'TAP', slot: 1, now: 2500 })
    expect(s.phase).toBe('correct')
    expect(s.streak).toBe(1)
    expect(s.bestStreak).toBe(1)
    expect(s.used).toEqual(['ben'])
    expect(s.timeToTapMs).toBe(1500)
    expect(s.lastOutcome).toBe('correct')
  })

  it('a tap at 4.99 s is scored; a tap at 5.01 s is a timeout', () => {
    const early = reduce(awaiting(), { type: 'TAP', slot: 1, now: 1000 + 4990 })
    expect(early.phase).toBe('correct')
    const late = reduce(awaiting(), { type: 'TAP', slot: 1, now: 1000 + 5010 })
    expect(late.phase).toBe('gameover')
    expect(late.lastOutcome).toBe('timeout')
    expect(late.tappedSlot).toBeNull()
  })

  it('TIMEOUT only fires once the clock really has run out', () => {
    const s = awaiting()
    expect(reduce(s, { type: 'TIMEOUT', now: 5999 })).toBe(s)
    const out = reduce(s, { type: 'TIMEOUT', now: 6000 })
    expect(out.phase).toBe('gameover')
    expect(out.lastOutcome).toBe('timeout')
  })

  it('a wrong tap ends the streak and records the tapped slot for the reveal', () => {
    let s = awaiting()
    s = reduce(s, { type: 'TAP', slot: 0, now: 2000 })
    expect(s.phase).toBe('gameover')
    expect(s.lastOutcome).toBe('wrong')
    expect(s.tappedSlot).toBe(0)
    expect(s.round?.answerSlot).toBe(1)
    // a second tap changes nothing
    expect(reduce(s, { type: 'TAP', slot: 1, now: 2100 })).toBe(s)
  })

  it('only the first tap registers', () => {
    const s = reduce(awaiting(), { type: 'TAP', slot: 1, now: 2000 })
    expect(reduce(s, { type: 'TAP', slot: 0, now: 2001 })).toBe(s)
    expect(reduce(s, { type: 'TIMEOUT', now: 9000 })).toBe(s)
  })

  it('NEXT after a correct answer spins again, carrying streak and used forward', () => {
    let s = reduce(awaiting(), { type: 'TAP', slot: 1, now: 2000 })
    s = reduce(s, { type: 'NEXT', round: round('joe', 2) })
    expect(s.phase).toBe('spinning')
    expect(s.streak).toBe(1)
    expect(s.used).toEqual(['ben'])
    expect(s.roundIndex).toBe(2)
    expect(s.revealAt).toBeNull()
    s = reduce(reduce(s, { type: 'LANDED' }), { type: 'REVEALED', now: 9000 })
    s = reduce(s, { type: 'TAP', slot: 2, now: 9500 })
    expect(s.streak).toBe(2)
    expect(s.used).toEqual(['ben', 'joe'])
  })

  it('START from game over resets the streak but keeps the best', () => {
    let s = reduce(awaiting(), { type: 'TAP', slot: 1, now: 2000 })
    s = reduce(s, { type: 'NEXT', round: round('joe') })
    s = reduce(reduce(s, { type: 'LANDED' }), { type: 'REVEALED', now: 9000 })
    s = reduce(s, { type: 'TAP', slot: 0, now: 9500 })
    expect(s.phase).toBe('gameover')
    expect(s.streak).toBe(1)
    s = reduce(s, { type: 'START', round: round('aaron') })
    expect(s.phase).toBe('spinning')
    expect(s.streak).toBe(0)
    expect(s.used).toEqual([])
    expect(s.bestStreak).toBe(1)
  })

  it('exhausting the bundle ends the game with its own outcome', () => {
    let s = reduce(awaiting(), { type: 'TAP', slot: 1, now: 2000 })
    s = reduce(s, { type: 'NEXT', round: null })
    expect(s.phase).toBe('gameover')
    expect(s.lastOutcome).toBe('exhausted')
    expect(s.streak).toBe(1)
  })

  it('ignores actions that do not apply to the current phase', () => {
    expect(reduce(initialState, { type: 'LANDED' })).toBe(initialState)
    expect(reduce(initialState, { type: 'REVEALED', now: 1 })).toBe(initialState)
    expect(reduce(initialState, { type: 'NEXT', round: round('x') })).toBe(initialState)
    const spinning = reduce(initialState, { type: 'START', round: round('ben') })
    expect(reduce(spinning, { type: 'START', round: round('ben') })).toBe(spinning)
  })

  it('SWAP_ROUND replaces the faces only while spinning and only for the same combo', () => {
    const r = round('ben')
    const spinning = reduce(initialState, { type: 'START', round: r })
    const swapped = { ...r, faces: ['q', 'ben', 'y'] as const, alumniCount: 1 }
    const s = reduce(spinning, { type: 'SWAP_ROUND', round: swapped })
    expect(s.round?.kind === 'faces' && s.round.faces).toEqual(['q', 'ben', 'y'])
    expect(s.roundIndex).toBe(spinning.roundIndex)
    const other = { ...swapped, combo: { ...r.combo, team: 'NE' } }
    expect(reduce(spinning, { type: 'SWAP_ROUND', round: other })).toBe(spinning)
    const landed = reduce(spinning, { type: 'LANDED' })
    expect(reduce(landed, { type: 'SWAP_ROUND', round: swapped })).toBe(landed)
  })
})

/**
 * The round state machine (spec §5), as a pure reducer. No React, no timers:
 * the hook in useGame.ts supplies rounds and clock readings.
 *
 *   idle ──START──▶ spinning ──LANDED──▶ awaiting (revealAt null: faces mounting)
 *                                          │ REVEALED(now): timer starts
 *                                          ├─TAP correct──▶ correct ──NEXT──▶ spinning
 *                                          ├─TAP wrong / TAP late / TIMEOUT──▶ gameover
 *   gameover ──START──▶ spinning
 */
import type { ProBowlRound } from '../game/probowl'
import type { Round, Slot } from '../game/select'

/** A round of either mode. The machine only needs answerSlot and usedKey. */
export type AnyRound = Round | ProBowlRound

export type Phase = 'idle' | 'spinning' | 'awaiting' | 'correct' | 'gameover'
export type Outcome = 'correct' | 'wrong' | 'timeout' | 'exhausted'

export interface GameState {
  phase: Phase
  /** Consecutive correct answers in the current streak. */
  streak: number
  /** Best streak seen this session (persistence arrives in M6). */
  bestStreak: number
  /** Answers already correct this streak (repeat protection). */
  used: readonly string[]
  round: AnyRound | null
  /** Increments every round; effects key on it. */
  roundIndex: number
  /** performance.now() when the faces were painted; null until then. */
  revealAt: number | null
  lastOutcome: Outcome | null
  tappedSlot: Slot | null
  timeToTapMs: number | null
}

export type Action =
  | { type: 'START'; round: AnyRound | null }
  | { type: 'LANDED' }
  | { type: 'REVEALED'; now: number }
  | { type: 'TAP'; slot: Slot; now: number }
  | { type: 'TIMEOUT'; now: number }
  | { type: 'NEXT'; round: AnyRound | null }
  /** Replace the faces of the round being spun (a photo failed to preload). Same combo, same roundIndex. */
  | { type: 'SWAP_ROUND'; round: AnyRound }
  /** Back to the start screen from anywhere (the header wordmark, Frank 2026-09-10). A live streak is abandoned, not recorded. */
  | { type: 'HOME' }

export const initialState: GameState = {
  phase: 'idle',
  streak: 0,
  bestStreak: 0,
  used: [],
  round: null,
  roundIndex: 0,
  revealAt: null,
  lastOutcome: null,
  tappedSlot: null,
  timeToTapMs: null,
}

export interface MachineConfig {
  decisionMs: number
}

export function createReducer(config: MachineConfig) {
  const spin = (
    s: GameState,
    round: AnyRound | null,
    streak: number,
    used: readonly string[],
  ): GameState => {
    if (!round) {
      // Every answer has been used: the board is cleared. Treated as a game over with its own outcome.
      return {
        ...s,
        phase: 'gameover',
        streak,
        used,
        lastOutcome: 'exhausted',
        tappedSlot: null,
        revealAt: null,
      }
    }
    return {
      ...s,
      phase: 'spinning',
      streak,
      used,
      round,
      roundIndex: s.roundIndex + 1,
      revealAt: null,
      lastOutcome: null,
      tappedSlot: null,
      timeToTapMs: null,
    }
  }
  const miss = (
    s: GameState,
    outcome: 'wrong' | 'timeout',
    slot: Slot | null,
    elapsed: number | null,
  ): GameState => ({
    ...s,
    phase: 'gameover',
    lastOutcome: outcome,
    tappedSlot: slot,
    timeToTapMs: elapsed,
    bestStreak: Math.max(s.bestStreak, s.streak),
  })

  return function reducer(s: GameState, a: Action): GameState {
    switch (a.type) {
      case 'HOME':
        return { ...initialState, bestStreak: Math.max(s.bestStreak, s.streak) }
      case 'START':
        if (s.phase !== 'idle' && s.phase !== 'gameover') return s
        return spin({ ...s, bestStreak: Math.max(s.bestStreak, s.streak) }, a.round, 0, [])
      case 'LANDED':
        return s.phase === 'spinning' ? { ...s, phase: 'awaiting', revealAt: null } : s
      case 'REVEALED':
        return s.phase === 'awaiting' && s.revealAt === null ? { ...s, revealAt: a.now } : s
      case 'TAP': {
        if (s.phase !== 'awaiting' || s.revealAt === null || !s.round) return s
        const elapsed = a.now - s.revealAt
        if (elapsed >= config.decisionMs) return miss(s, 'timeout', null, null)
        if (a.slot === s.round.answerSlot) {
          const streak = s.streak + 1
          return {
            ...s,
            phase: 'correct',
            streak,
            bestStreak: Math.max(s.bestStreak, streak),
            used: [...s.used, s.round.usedKey],
            lastOutcome: 'correct',
            tappedSlot: a.slot,
            timeToTapMs: elapsed,
          }
        }
        return miss(s, 'wrong', a.slot, elapsed)
      }
      case 'TIMEOUT': {
        if (s.phase !== 'awaiting' || s.revealAt === null) return s
        if (a.now - s.revealAt < config.decisionMs) return s
        return miss(s, 'timeout', null, null)
      }
      case 'NEXT':
        return s.phase === 'correct' ? spin(s, a.round, s.streak, s.used) : s
      case 'SWAP_ROUND':
        return s.phase === 'spinning' && s.round && a.round.combo === s.round.combo
          ? { ...s, round: a.round }
          : s
    }
  }
}

/** Milliseconds left on the decision timer, clamped at 0. */
export function remainingMs(s: GameState, now: number, decisionMs: number): number {
  if (s.phase !== 'awaiting' || s.revealAt === null) return decisionMs
  return Math.max(0, decisionMs - (now - s.revealAt))
}

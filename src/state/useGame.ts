/**
 * React glue for the state machine: supplies rounds, drives the spin and
 * feedback delays, and enforces the decision timer on a monotonic clock.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { Bundle } from '../game/bundle'
import type { GameConfig } from '../game/config'
import { defaultRng, type Rng } from '../game/rng'
import { nextRound, type Slot } from '../game/select'
import { createReducer, initialState, type Action, type GameState } from './machine'

export interface GameApi {
  state: GameState
  /** Start a new streak (from idle or game over). */
  start: () => void
  /** Player tapped a face card. */
  tap: (slot: Slot) => void
  /** Face cards report that they are painted; the timer starts now. */
  onPainted: () => void
  config: GameConfig
}

const now = () => performance.now()

export function useGame(bundle: Bundle, config: GameConfig, rng: Rng = defaultRng): GameApi {
  const reducer = useMemo(
    () => createReducer({ decisionMs: config.decisionMs }),
    [config.decisionMs],
  )
  const [state, dispatch] = useReducer(reducer, initialState)

  const pick = useCallback(
    (used: readonly string[]) =>
      nextRound(bundle, new Set(used), rng, { alumniProb: config.alumniProb }),
    [bundle, rng, config.alumniProb],
  )

  const start = useCallback(() => dispatch({ type: 'START', round: pick([]) }), [pick])
  const tap = useCallback((slot: Slot) => dispatch({ type: 'TAP', slot, now: now() }), [])
  const onPainted = useCallback(() => dispatch({ type: 'REVEALED', now: now() }), [])

  // Spinning: the wheels land one after another, then the faces are shown.
  useEffect(() => {
    if (state.phase !== 'spinning') return
    const t = setTimeout(
      () => dispatch({ type: 'LANDED' }),
      config.wheels.length * config.spinMsPerWheel,
    )
    return () => clearTimeout(t)
  }, [state.phase, state.roundIndex, config.wheels.length, config.spinMsPerWheel])

  // Awaiting: enforce the deadline. The reducer re-checks the clock, so a
  // throttled timer can only fire late, never early.
  useEffect(() => {
    if (state.phase !== 'awaiting' || state.revealAt === null) return
    const fire = () => dispatch({ type: 'TIMEOUT', now: now() })
    const delay = Math.max(0, config.decisionMs - (now() - state.revealAt)) + 5
    const t = setTimeout(fire, delay)
    // Also poll on animation frames so a backgrounded tab times out on return.
    let raf = 0
    const tick = () => {
      if (now() - state.revealAt! >= config.decisionMs) fire()
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state.phase, state.revealAt, config.decisionMs])

  // Correct: brief feedback, then the next spin begins on its own.
  useEffect(() => {
    if (state.phase !== 'correct') return
    const used = state.used
    const t = setTimeout(() => dispatch({ type: 'NEXT', round: pick(used) }), config.feedbackMs)
    return () => clearTimeout(t)
  }, [state.phase, state.roundIndex, state.used, config.feedbackMs, pick])

  // Keys 1/2/3 tap the slots.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') tap((Number(e.key) - 1) as Slot)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tap])

  return { state, start, tap, onPainted, config }
}

export type { Action, GameState }

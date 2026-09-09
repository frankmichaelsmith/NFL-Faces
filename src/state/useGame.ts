/**
 * React glue for the state machine: supplies rounds, drives the spin and
 * feedback delays, and enforces the decision timer on a monotonic clock.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { Bundle } from '../game/bundle'
import type { GameConfig } from '../game/config'
import { defaultRng, type Rng } from '../game/rng'
import { nextRound, replaceFace, type Slot } from '../game/select'
import { createReducer, initialState, type Action, type GameState } from './machine'

export interface GameApi {
  state: GameState
  /** Base URL for face images; exposed so the screen and the preloader agree. */
  imageBaseUrl: string
  /** Start a new streak (from idle or game over). */
  start: () => void
  /** Player tapped a face card. */
  tap: (slot: Slot) => void
  /** Face cards report that they are painted; the timer starts now. */
  onPainted: () => void
  config: GameConfig
}

const now = () => performance.now()

export function useGame(
  bundle: Bundle,
  config: GameConfig,
  rng: Rng = defaultRng,
  imageBaseUrl = '/faces/',
): GameApi {
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

  // Spinning: preload the three faces. A wrong face that fails to load is
  // swapped for another distractor before anyone sees it; the answer's card
  // falls back to initials at render time (FaceCards), never a broken image.
  useEffect(() => {
    if (state.phase !== 'spinning' || !state.round) return
    const round = state.round
    let cancelled = false
    const imgs = round.faces.map((id, i) => {
      const photo = bundle.people[id]?.photo
      if (!photo || typeof Image === 'undefined') return null
      const img = new Image()
      img.onerror = () => {
        if (cancelled || i === round.answerSlot) return
        const swapped = replaceFace(round, i as Slot, rng, { alumniProb: config.alumniProb })
        if (swapped) dispatch({ type: 'SWAP_ROUND', round: swapped })
      }
      img.src = imageBaseUrl + photo
      return img
    })
    return () => {
      cancelled = true
      imgs.forEach((img) => img && (img.onerror = null))
    }
  }, [state.phase, state.round, bundle, rng, config.alumniProb, imageBaseUrl])

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

  return { state, start, tap, onPainted, config, imageBaseUrl }
}

export type { Action, GameState }

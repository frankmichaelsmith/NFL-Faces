/**
 * React glue for the state machine: supplies rounds, drives the spin and
 * feedback delays, and enforces the decision timer on a monotonic clock.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { poolOf, type Bundle } from '../game/bundle'
import { configFor, type GameConfig, type Mode } from '../game/config'
import { nextProBowlRound } from '../game/probowl'
import { defaultRng, type Rng } from '../game/rng'
import { nextRound, replaceFace, type Slot } from '../game/select'
import { wheelValue } from '../components/Wheels'
import { optionImage } from '../components/OptionCards'
import { type Analytics, defaultAnalytics } from '../analytics/analytics'
import { createFeedback, type Feedback } from '../audio/feedback'
import {
  loadStats,
  recordRound,
  recordStreakEnd,
  saveStats,
  setMute,
  type Stats,
} from '../storage/local'
import { createReducer, initialState, type Action, type GameState } from './machine'

export interface GameApi {
  state: GameState
  mode: Mode
  /** Base URL for face images; exposed so the screen and the preloader agree. */
  imageBaseUrl: string
  /** Device-local stats (best streak, totals). Updated as rounds and streaks finish. */
  stats: Stats
  /** The roll that ended the current game, as wheel labels, once in game over. */
  losingRoll: string | null
  /** Start a new streak (from idle or game over). */
  start: () => void
  /** Back to the start screen from anywhere; a streak in progress is abandoned. */
  home: () => void
  /** Player tapped a face card. */
  tap: (slot: Slot) => void
  /** Face cards report that they are painted; the timer starts now. */
  onPainted: () => void
  config: GameConfig
  /** A wheel stopped: tick + light haptic. */
  onWheelLand: (index: number) => void
  muted: boolean
  toggleMute: () => void
  analytics: Analytics
}

export interface GameDeps {
  analytics?: Analytics
  feedback?: Feedback
}

const now = () => performance.now()
const NO_OVERRIDES: Partial<GameConfig> = {}

export function useGame(
  bundle: Bundle,
  mode: Mode,
  rng: Rng = defaultRng,
  imageBaseUrl = '/faces/',
  deps: GameDeps = {},
  overrides: Partial<GameConfig> = NO_OVERRIDES,
): GameApi {
  const config = useMemo(() => ({ ...configFor(mode), ...overrides }), [mode, overrides])
  const rollLabel = (s: GameState) =>
    s.round
      ? config.wheels.map((w) => wheelValue(bundle, w.kind, s.round!, config.poolKey)).join(' · ')
      : null
  const reducer = useMemo(
    () => createReducer({ decisionMs: config.decisionMs }),
    [config.decisionMs],
  )
  const [stats, setStats] = useState<Stats>(() => loadStats())
  const [analytics] = useState(() => deps.analytics ?? defaultAnalytics())
  const [feedback] = useState(() => deps.feedback ?? createFeedback(stats.mute))
  const [muted, setMuted] = useState(stats.mute)
  const statsRef = useRef(stats)
  useEffect(() => {
    statsRef.current = stats
  }, [stats])
  const [state, dispatch] = useReducer(reducer, initialState, (s) => ({
    ...s,
    bestStreak: stats.modes[mode].best_streak,
  }))

  // One session_started per mount, identified by the anonymous device id.
  const sessionSent = useRef(false)
  useEffect(() => {
    if (sessionSent.current) return
    sessionSent.current = true
    analytics.identify(stats.device_id)
    analytics.track('session_started', { build_hash: bundle.buildHash })
  }, [analytics, stats.device_id, bundle.buildHash])

  // Persist outcomes exactly once per round (StrictMode runs effects twice in dev).
  const recorded = useRef<string | null>(null)
  const losingRoll = state.phase === 'gameover' ? rollLabel(state) : null
  useEffect(() => {
    const isEnd = state.phase === 'gameover' && state.lastOutcome !== null
    const isRound = state.phase === 'correct' || (isEnd && state.lastOutcome !== 'exhausted')
    if (!isRound && !isEnd) return
    const key = `${state.roundIndex}:${state.phase}`
    if (recorded.current === key) return
    recorded.current = key
    if (isRound && state.round?.kind === 'faces' && state.lastOutcome !== 'exhausted') {
      analytics.track('round_completed', {
        season: state.round.combo.season,
        team_id: state.round.combo.team,
        role: state.round.combo.role,
        answer_id: state.round.combo.answer,
        distractor_ids: state.round.faces.filter((f) => f !== state.round?.combo.answer),
        answer_slot: state.round.answerSlot,
        tapped_slot: state.tappedSlot,
        outcome: state.lastOutcome as 'correct' | 'wrong' | 'timeout',
        time_to_tap_ms: state.timeToTapMs,
        streak_position: state.phase === 'correct' ? state.streak : state.streak + 1,
        build_hash: bundle.buildHash,
      })
    }
    if (isRound && state.round?.kind === 'probowl' && state.lastOutcome !== 'exhausted') {
      analytics.track('pool_round_completed', {
        mode: mode === 'nba' ? 'nba' : 'probowl',
        season: state.round.combo.season,
        player_id: state.round.combo.player,
        category: state.round.combo.category,
        answer: state.round.combo.answer,
        answer_slot: state.round.answerSlot,
        tapped_slot: state.tappedSlot,
        outcome: state.lastOutcome as 'correct' | 'wrong' | 'timeout',
        time_to_tap_ms: state.timeToTapMs,
        streak_position: state.phase === 'correct' ? state.streak : state.streak + 1,
        build_hash: bundle.buildHash,
      })
    }
    if (isRound && state.lastOutcome !== 'exhausted')
      feedback.play(state.phase === 'correct' ? 'correct' : 'miss')
    // Side effects stay outside the state updater: StrictMode runs updaters twice in dev.
    const prev = statsRef.current
    let next = isRound ? recordRound(prev) : prev
    if (isEnd) {
      analytics.track('streak_ended', {
        streak_length: state.streak,
        end_reason: state.lastOutcome as 'wrong' | 'timeout' | 'exhausted',
        is_new_best: state.streak > prev.modes[mode].best_streak,
      })
      next = recordStreakEnd(next, state.streak, losingRoll ?? '', mode)
    }
    statsRef.current = next
    saveStats(next)
    setStats(next)
  }, [
    state.phase,
    state.roundIndex,
    state.lastOutcome,
    state.streak,
    state.round,
    state.tappedSlot,
    state.timeToTapMs,
    losingRoll,
    analytics,
    feedback,
    bundle.buildHash,
    mode,
  ])

  const onWheelLand = useCallback(() => feedback.play('tick'), [feedback])
  const toggleMute = () => {
    const next = !muted
    feedback.setMuted(next)
    if (!next) feedback.unlock()
    analytics.track('mute_toggled', { muted: next })
    const s = setMute(statsRef.current, next)
    statsRef.current = s
    saveStats(s)
    setStats(s)
    setMuted(next)
  }

  const pick = useCallback(
    (used: readonly string[]) =>
      config.poolKey
        ? poolOf(bundle, config.poolKey)
          ? nextProBowlRound(poolOf(bundle, config.poolKey)!, new Set(used), rng, {
              categories: config.categoryWeights,
              seasons: config.seasonWeights,
              answerShares: config.answerShares,
            })
          : null
        : nextRound(bundle, new Set(used), rng, { alumniProb: config.alumniProb }),
    [
      bundle,
      rng,
      config.alumniProb,
      config.categoryWeights,
      config.seasonWeights,
      config.answerShares,
      config.poolKey,
    ],
  )

  const start = useCallback(() => {
    feedback.unlock()
    dispatch({ type: 'START', round: pick([]) })
  }, [pick, feedback])
  const home = useCallback(() => dispatch({ type: 'HOME' }), [])
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
    if (state.phase !== 'spinning' || state.round?.kind !== 'faces') return
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

  // Spinning (Pro Bowl): warm the logo / tile images so the cards paint instantly.
  useEffect(() => {
    if (
      state.phase !== 'spinning' ||
      state.round?.kind !== 'probowl' ||
      typeof Image === 'undefined'
    )
      return
    const base = typeof import.meta.env.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/'
    const imgs: HTMLImageElement[] = []
    for (const value of state.round.options) {
      const src = optionImage(state.round.combo.category, value, base, config.poolKey)
      if (!src) continue
      const img = new Image()
      img.src = src
      imgs.push(img)
    }
    return () => imgs.forEach((img) => (img.src = ''))
  }, [state.phase, state.round, config.poolKey])

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

  return {
    state,
    mode,
    start,
    home,
    tap,
    onPainted,
    config,
    imageBaseUrl,
    stats,
    losingRoll,
    onWheelLand,
    muted,
    toggleMute,
    analytics,
  }
}

export type { Action, GameState }

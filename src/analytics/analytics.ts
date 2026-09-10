/**
 * Analytics event layer (spec §16). Events are typed here; delivery goes
 * through a Backend. v1 ships the no-op backend (console in dev). Wiring
 * PostHog later means adding one backend file and choosing it in App.tsx.
 * No PII: the only identity is the anonymous device id.
 */

export type Outcome = 'correct' | 'wrong' | 'timeout'

export interface RoundCompleted {
  season: number
  team_id: string
  role: string
  answer_id: string
  distractor_ids: string[]
  answer_slot: 0 | 1 | 2
  tapped_slot: 0 | 1 | 2 | null
  outcome: Outcome
  time_to_tap_ms: number | null
  /** 1-indexed round number within the streak. */
  streak_position: number
  build_hash: string
}

export interface StreakEnded {
  streak_length: number
  end_reason: 'wrong' | 'timeout' | 'exhausted'
  is_new_best: boolean
}

export interface Events {
  session_started: { build_hash: string }
  round_completed: RoundCompleted
  streak_ended: StreakEnded
  share_clicked: { format: 'native' | 'text' | 'clipboard' | 'download' | 'failed' | 'cancelled' }
  mute_toggled: { muted: boolean }
  /** Leaderboard (decision 0008). No email or name ever goes to analytics. */
  signup_completed: { renamed: boolean }
  score_posted: { streak: number; rank: number; improved: boolean }
  leaderboard_opened: { from: 'start' | 'gameover' }
}

export type EventName = keyof Events

export interface Backend {
  identify(deviceId: string): void
  capture<N extends EventName>(name: N, props: Events[N]): void
}

export interface Analytics {
  identify(deviceId: string): void
  track<N extends EventName>(name: N, props: Events[N]): void
}

export const noopBackend: Backend = { identify() {}, capture() {} }

export const consoleBackend: Backend = {
  identify: (id) => console.debug('[analytics] identify', id),
  capture: (name, props) => console.debug('[analytics]', name, props),
}

/** A backend that keeps every call; used by tests. */
export function memoryBackend() {
  const calls: { name: EventName; props: unknown }[] = []
  const ids: string[] = []
  const backend: Backend = {
    identify: (id) => ids.push(id),
    capture: (name, props) => calls.push({ name, props }),
  }
  return { backend, calls, ids }
}

export function createAnalytics(backend: Backend): Analytics {
  return {
    identify: (id) => safe(() => backend.identify(id)),
    track: (name, props) => safe(() => backend.capture(name, props)),
  }
}

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    /* analytics must never break play */
  }
}

/** The app's default: console in dev, silent in production until PostHog is wired. */
export function defaultAnalytics(): Analytics {
  return createAnalytics(import.meta.env.DEV ? consoleBackend : noopBackend)
}

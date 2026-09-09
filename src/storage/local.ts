/**
 * Device-local persistence (spec §13). No accounts, no server. Every access is
 * wrapped so a blocked or missing localStorage never breaks play.
 */

export interface Stats {
  best_streak: number
  /** The roll that ended the best streak, e.g. "2008 · BROWNS". Ties do not overwrite it. */
  best_streak_roll: string | null
  total_rounds: number
  total_streaks: number
  mute: boolean
  first_played_at: string | null
  device_id: string
}

const KEY = 'nfl-faces:stats:v1'

export function defaultStats(): Stats {
  return {
    best_streak: 0,
    best_streak_roll: null,
    total_rounds: 0,
    total_streaks: 0,
    mute: true,
    first_played_at: null,
    device_id: newDeviceId(),
  }
}

function newDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return 'd-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Load stats, filling any missing field with its default. Persists a fresh device id on first load. */
export function loadStats(): Stats {
  const base = defaultStats()
  const s = storage()
  if (!s) return base
  try {
    const raw = s.getItem(KEY)
    if (!raw) {
      s.setItem(KEY, JSON.stringify(base))
      return base
    }
    const parsed = JSON.parse(raw) as Partial<Stats>
    const merged: Stats = { ...base, ...parsed }
    if (typeof merged.best_streak !== 'number' || !Number.isFinite(merged.best_streak))
      merged.best_streak = 0
    return merged
  } catch {
    return base
  }
}

export function saveStats(stats: Stats): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify(stats))
  } catch {
    /* quota or privacy mode: play on without persistence */
  }
}

/** Apply one finished round. */
export function recordRound(stats: Stats, now = new Date()): Stats {
  return {
    ...stats,
    total_rounds: stats.total_rounds + 1,
    first_played_at: stats.first_played_at ?? now.toISOString(),
  }
}

/** Apply a streak ending at `streak` on `roll`. Best updates only on a strict improvement. */
export function recordStreakEnd(stats: Stats, streak: number, roll: string): Stats {
  const improved = streak > stats.best_streak
  return {
    ...stats,
    total_streaks: stats.total_streaks + 1,
    best_streak: improved ? streak : stats.best_streak,
    best_streak_roll: improved ? roll : stats.best_streak_roll,
  }
}

export function setMute(stats: Stats, mute: boolean): Stats {
  return { ...stats, mute }
}

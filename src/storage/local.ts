/**
 * Device-local persistence (spec §13). No accounts, no server. Every access is
 * wrapped so a blocked or missing localStorage never breaks play.
 */

export type StatsMode = 'faces' | 'probowl' | 'nba'

export interface ModeBest {
  best_streak: number
  best_streak_roll: string | null
}

/** Best of one Eastern calendar day (the leaderboard's day), kept per mode. */
export interface DailyBest extends ModeBest {
  day: string
  games: number
}

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
/** The leaderboard day for an instant: the calendar date in New York (same rule as the server). */
export function etDay(now: Date = new Date()): string {
  return ET_DAY.format(now)
}

export interface Stats {
  /** Faces mode best (kept as the original fields for compatibility; mirrored in `modes.faces`). */
  best_streak: number
  /** The roll that ended the best streak, e.g. "2008 · BROWNS". Ties do not overwrite it. */
  best_streak_roll: string | null
  total_rounds: number
  total_streaks: number
  mute: boolean
  first_played_at: string | null
  device_id: string
  /** Per-mode bests. */
  modes: Record<StatsMode, ModeBest>
  /** Per-mode best of the current Eastern day; stale days are reset on the next streak end. */
  daily: Record<StatsMode, DailyBest>
  /** Mode last chosen on the start screen. */
  last_mode: StatsMode
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
    modes: {
      faces: { best_streak: 0, best_streak_roll: null },
      probowl: { best_streak: 0, best_streak_roll: null },
      nba: { best_streak: 0, best_streak_roll: null },
    },
    daily: {
      faces: { day: '', best_streak: 0, best_streak_roll: null, games: 0 },
      probowl: { day: '', best_streak: 0, best_streak_roll: null, games: 0 },
      nba: { day: '', best_streak: 0, best_streak_roll: null, games: 0 },
    },
    last_mode: 'faces',
  }
}

/** Today's record for a mode, or null when the last game in that mode was on another day. */
export function todayBest(stats: Stats, mode: StatsMode, now: Date = new Date()): DailyBest | null {
  const d = stats.daily[mode]
  return d.day === etDay(now) && d.games > 0 ? d : null
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
    const merged: Stats = {
      ...base,
      ...parsed,
      modes: { ...base.modes, ...(parsed.modes ?? {}) },
      daily: { ...base.daily, ...(parsed.daily ?? {}) },
    }
    if (typeof merged.best_streak !== 'number' || !Number.isFinite(merged.best_streak))
      merged.best_streak = 0
    // Stats written before Pro Bowl Mode existed: lift the faces best into the per-mode record.
    if (merged.modes.faces.best_streak < merged.best_streak)
      merged.modes.faces = {
        best_streak: merged.best_streak,
        best_streak_roll: merged.best_streak_roll,
      }
    if (!['faces', 'probowl', 'nba'].includes(merged.last_mode)) merged.last_mode = 'faces'
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

/** Apply a streak ending at `streak` on `roll` in `mode`. Best updates only on a strict improvement. */
export function recordStreakEnd(
  stats: Stats,
  streak: number,
  roll: string,
  mode: StatsMode = 'faces',
  now: Date = new Date(),
): Stats {
  const prev = stats.modes[mode]
  const improved = streak > prev.best_streak
  const next: ModeBest = improved ? { best_streak: streak, best_streak_roll: roll } : prev
  const day = etDay(now)
  const d = stats.daily[mode]
  const today: DailyBest =
    d.day === day ? d : { day, best_streak: 0, best_streak_roll: null, games: 0 }
  const daily: DailyBest =
    streak > today.best_streak
      ? { day, best_streak: streak, best_streak_roll: roll, games: today.games + 1 }
      : { ...today, games: today.games + 1 }
  return {
    ...stats,
    total_streaks: stats.total_streaks + 1,
    modes: { ...stats.modes, [mode]: next },
    daily: { ...stats.daily, [mode]: daily },
    best_streak: mode === 'faces' ? next.best_streak : stats.best_streak,
    best_streak_roll: mode === 'faces' ? next.best_streak_roll : stats.best_streak_roll,
  }
}

export function setLastMode(stats: Stats, mode: StatsMode): Stats {
  return { ...stats, last_mode: mode }
}

export function setMute(stats: Stats, mute: boolean): Stats {
  return { ...stats, mute }
}

/**
 * Leaderboard client (decision 0008). No React. Talks to /api/* with the
 * device's bearer token, keeps the identity in localStorage, and queues score
 * posts that fail on the network so a streak played offline still counts
 * once the phone is back online. Every storage access is guarded.
 */
import type {
  ApiError,
  LeaderboardResponse,
  RegisterResponse,
  ScoreRequest,
  ScoreResponse,
} from './types'

export interface Identity {
  playerId: string
  name: string
  email: string
  token: string
}
export interface PendingScore extends ScoreRequest {
  at: string
}

export type SubmitResult =
  | { ok: true; result: ScoreResponse }
  | { ok: false; reason: 'unregistered' | 'signed_out' | 'offline' | 'error'; message: string }
export type RegisterResult = { ok: true; identity: Identity } | { ok: false; message: string }

export interface LeaderboardClient {
  identity(): Identity | null
  register(email: string, name: string): Promise<RegisterResult>
  /** Post a finished streak. Queued (and reported as offline) when the network fails. */
  submitScore(score: ScoreRequest): Promise<SubmitResult>
  /** Retry queued posts. Safe to call often. */
  flush(): Promise<void>
  /** Today's board (or a given YYYY-MM-DD). Throws on failure. */
  board(day?: string): Promise<LeaderboardResponse>
  signOut(): void
}

export const IDENTITY_KEY = 'nfl-faces:player:v1'
export const QUEUE_KEY = 'nfl-faces:score-queue:v1'
const QUEUE_MAX = 20
const NETWORK_MESSAGE = "You're offline. Your streak will post when you're back."

export interface ClientOptions {
  fetch?: typeof fetch
  storage?: Storage | null
  baseUrl?: string
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function createLeaderboardClient(opts: ClientOptions = {}): LeaderboardClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const base = (opts.baseUrl ?? '').replace(/\/$/, '')

  const read = <T>(key: string): T | null => {
    try {
      const raw = storage?.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }
  const write = (key: string, value: unknown) => {
    try {
      if (value === null) storage?.removeItem(key)
      else storage?.setItem(key, JSON.stringify(value))
    } catch {
      /* quota or privacy mode */
    }
  }
  const identity = () => {
    const id = read<Identity>(IDENTITY_KEY)
    return id && typeof id.token === 'string' && typeof id.playerId === 'string' ? id : null
  }
  const queue = () => read<PendingScore[]>(QUEUE_KEY) ?? []

  /** POST/GET JSON. Returns null status on a network failure. */
  async function call<T>(
    path: string,
    init: { method?: string; body?: unknown; token?: string | null } = {},
  ): Promise<{ status: number | null; body: T | ApiError | null }> {
    const headers: Record<string, string> = {}
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.token) headers['authorization'] = `Bearer ${init.token}`
    try {
      const res = await doFetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      let body: T | ApiError | null = null
      try {
        body = (await res.json()) as T | ApiError
      } catch {
        body = null
      }
      return { status: res.status, body }
    } catch {
      return { status: null, body: null }
    }
  }
  const messageOf = (body: unknown, fallback: string) =>
    body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message
      : fallback

  async function post(score: ScoreRequest, token: string): Promise<SubmitResult> {
    const r = await call<ScoreResponse>('/api/score', { method: 'POST', body: score, token })
    if (r.status === null) return { ok: false, reason: 'offline', message: NETWORK_MESSAGE }
    if (r.status === 401) {
      write(IDENTITY_KEY, null)
      return { ok: false, reason: 'signed_out', message: 'Add your email again to keep scoring' }
    }
    if (r.status !== 200 || !r.body || 'error' in r.body)
      return {
        ok: false,
        reason: 'error',
        message: messageOf(r.body, 'Could not post your streak'),
      }
    return { ok: true, result: r.body }
  }

  async function drain(): Promise<void> {
    const id = identity()
    if (!id) return
    let pending = queue()
    while (pending.length) {
      const next = pending[0]!
      const r = await post(next, id.token)
      if (!r.ok && r.reason === 'offline') break
      pending = pending.slice(1)
      write(QUEUE_KEY, pending.length ? pending : null)
      if (!r.ok && r.reason === 'signed_out') break
    }
  }
  // One drain at a time. The memo is cleared in a .finally callback, which runs after
  // the assignment below even when drain() completes synchronously (empty queue).
  let flushing: Promise<void> | null = null
  const flush = () => {
    if (flushing) return flushing
    const p = drain().finally(() => {
      if (flushing === p) flushing = null
    })
    flushing = p
    return p
  }

  return {
    identity,
    async register(email, name) {
      const r = await call<RegisterResponse>('/api/register', {
        method: 'POST',
        body: { email, name },
      })
      if (r.status === null) return { ok: false, message: NETWORK_MESSAGE }
      if ((r.status !== 200 && r.status !== 201) || !r.body || 'error' in r.body)
        return { ok: false, message: messageOf(r.body, 'Could not sign you up') }
      const id: Identity = {
        playerId: r.body.playerId,
        name: r.body.name,
        email: email.trim().toLowerCase(),
        token: r.body.token,
      }
      write(IDENTITY_KEY, id)
      void flush()
      return { ok: true, identity: id }
    },
    async submitScore(score) {
      const id = identity()
      if (!id) return { ok: false, reason: 'unregistered', message: 'Add your email to join' }
      await flush()
      const r = await post(score, id.token)
      if (!r.ok && r.reason === 'offline') {
        const pending = [...queue(), { ...score, at: new Date().toISOString() }].slice(-QUEUE_MAX)
        write(QUEUE_KEY, pending)
      }
      return r
    },
    flush,
    async board(day) {
      const id = identity()
      const r = await call<LeaderboardResponse>(
        `/api/leaderboard${day ? `?day=${encodeURIComponent(day)}` : ''}`,
        { token: id?.token ?? null },
      )
      if (r.status !== 200 || !r.body || 'error' in r.body)
        throw new Error(
          r.status === null ? NETWORK_MESSAGE : messageOf(r.body, 'Leaderboard unavailable'),
        )
      return r.body
    },
    signOut() {
      write(IDENTITY_KEY, null)
    },
  }
}

/** "2026-09-09" → "Wed, Sep 9". Parsed as calendar parts, so no time-zone drift. */
export function formatDay(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return day
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

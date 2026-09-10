/**
 * Leaderboard glue for the game (decision 0008): posts each finished streak
 * once, knows when the sign-up gate must show (played once, no identity), and
 * signs a player up — posting the streak that just ended right away.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameApi } from '../state/useGame'
import type { Identity, LeaderboardClient } from './client'
import type { ScoreResponse } from './types'

export interface LeaderboardApi {
  client: LeaderboardClient
  identity: Identity | null
  /** True once the device has finished a streak without an email on file. Play is gated until sign-up. */
  needsSignUp: boolean
  /** Register and, if a game just ended, post its streak. Resolves to an error message or null. */
  signUp: (email: string, name: string) => Promise<string | null>
  /** The server's answer for the streak that just ended, once posted. */
  posted: ScoreResponse | null
  /** Why the last post did not land, if it did not. */
  postError: string | null
}

export function useLeaderboard(game: GameApi, client: LeaderboardClient): LeaderboardApi {
  const [identity, setIdentity] = useState<Identity | null>(() => client.identity())
  // The outcome of the post for one specific game (keyed by round), so a new game shows nothing stale.
  const [outcome, setOutcome] = useState<{
    round: number
    result: ScoreResponse | null
    error: string | null
  } | null>(null)
  const postedFor = useRef<number | null>(null)
  const { state, mode, losingRoll, analytics } = game
  const over = state.phase === 'gameover' && state.lastOutcome !== null

  const submit = useCallback(async () => {
    const round = state.roundIndex
    const r = await client.submitScore({ streak: state.streak, roll: losingRoll, mode })
    if (r.ok) {
      setOutcome({ round, result: r.result, error: null })
      analytics.track('score_posted', {
        streak: state.streak,
        rank: r.result.rank,
        improved: r.result.improved,
      })
    } else {
      setOutcome({ round, result: null, error: r.reason === 'unregistered' ? null : r.message })
      if (r.reason === 'signed_out') setIdentity(null)
    }
  }, [client, state.roundIndex, state.streak, losingRoll, mode, analytics])

  // One post per finished game, as soon as it ends.
  useEffect(() => {
    if (!over || postedFor.current === state.roundIndex) return
    postedFor.current = state.roundIndex
    void submit()
  }, [over, state.roundIndex, submit])

  // Retry anything queued while offline.
  useEffect(() => {
    void client.flush()
    const onOnline = () => void client.flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [client])

  const signUp = useCallback(
    async (email: string, name: string) => {
      const r = await client.register(email, name)
      if (!r.ok) return r.message
      setIdentity(r.identity)
      analytics.track('signup_completed', { renamed: false })
      if (over) await submit()
      return null
    },
    [client, analytics, over, submit],
  )

  const current = over && outcome?.round === state.roundIndex ? outcome : null
  return {
    client,
    identity,
    needsSignUp: !identity && game.stats.total_streaks >= 1,
    signUp,
    posted: current?.result ?? null,
    postError: current?.error ?? null,
  }
}

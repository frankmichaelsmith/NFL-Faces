import { useEffect, useState } from 'react'
import { formatDay, type LeaderboardClient } from '../leaderboard/client'
import type { LeaderboardResponse } from '../leaderboard/types'

interface Props {
  client: LeaderboardClient
  onClose: () => void
  /** Shown under the list when the device has no email on file. */
  signedIn: boolean
}

/** Today's top 25 (decision 0008), the caller's row marked, their standing shown even when outside the list. */
export function LeaderboardScreen({ client, onClose, signedIn }: Props) {
  const [board, setBoard] = useState<LeaderboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    client
      .board()
      .then((b) => !cancelled && setBoard(b))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [client])
  const youOutside = board?.you && !board.rows.some((r) => r.you) ? board.you : null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Today's leaderboard"
      data-testid="leaderboard"
      className="fixed inset-0 z-20 flex flex-col bg-ink/95 p-4 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 overflow-hidden">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-3xl font-black uppercase tracking-tight">
              Today&apos;s leaderboard
            </h2>
            <p className="text-xs uppercase tracking-widest text-white/50">
              {board
                ? `${formatDay(board.day)} · ${board.rounds.toLocaleString()} rounds played`
                : ' '}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="close-board"
            className="min-h-[44px] rounded-xl border border-white/20 px-4 text-sm font-bold"
          >
            Close
          </button>
        </header>
        <ol className="flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-card">
          {error && (
            <li className="p-4 text-center text-sm text-white/60" data-testid="board-error">
              {error}
            </li>
          )}
          {board && board.rows.length === 0 && !error && (
            <li className="p-4 text-center text-sm text-white/60">
              Nobody has posted a streak yet today. Yours could be first.
            </li>
          )}
          {board?.rows.map((r) => (
            <li
              key={r.rank}
              data-testid="board-row"
              data-you={r.you ? 'true' : undefined}
              className={
                'flex items-center gap-3 border-b border-white/5 px-4 py-2.5 ' +
                (r.you ? 'bg-accent/15 text-accent' : '')
              }
            >
              <span className="w-8 text-right font-mono text-sm text-white/50">{r.rank}</span>
              <span className="flex-1 truncate font-bold">
                {r.name}
                {r.you ? <span className="ml-2 text-xs uppercase tracking-widest">you</span> : null}
              </span>
              <span className="font-display text-2xl font-black">{r.streak}</span>
            </li>
          ))}
          {youOutside && (
            <li
              data-testid="board-you"
              className="flex items-center gap-3 border-t border-white/10 bg-accent/15 px-4 py-2.5 text-accent"
            >
              <span className="w-8 text-right font-mono text-sm">{youOutside.rank}</span>
              <span className="flex-1 truncate font-bold">
                {youOutside.name}
                <span className="ml-2 text-xs uppercase tracking-widest">you</span>
              </span>
              <span className="font-display text-2xl font-black">{youOutside.streak}</span>
            </li>
          )}
        </ol>
        {!signedIn && (
          <p className="text-center text-xs text-white/50">
            Finish a streak and add your email to get on the board.
          </p>
        )}
      </div>
    </div>
  )
}

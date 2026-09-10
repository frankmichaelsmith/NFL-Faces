import { useEffect, useState } from 'react'
import { FIRST_BOARD_DAY, addDays, formatDay, type LeaderboardClient } from '../leaderboard/client'
import type { LeaderboardResponse } from '../leaderboard/types'

interface Props {
  client: LeaderboardClient
  onClose: () => void
  /** Shown under the list when the device has no email on file. */
  signedIn: boolean
  /** Which sport's board. */
  mode?: 'probowl' | 'nba'
  /** The NFL | NBA toggle, when the app offers both. */
  onMode?: (mode: 'probowl' | 'nba') => void
}

/**
 * A day's top 25 (decision 0008), the caller's row marked, their standing shown
 * even when outside the list. Arrows step back through earlier days (Frank,
 * 2026-09-10) as far as the board's first day, and forward again to today.
 */
export function LeaderboardScreen({ client, onClose, signedIn, mode = 'probowl', onMode }: Props) {
  // null = today (the server decides which day that is); a date = a past day.
  const [day, setDay] = useState<string | null>(null)
  // Results are keyed by the day they were requested for, so switching days shows a
  // clean loading state without resetting anything inside an effect.
  const [loaded, setLoaded] = useState<{ day: string | null; board: LeaderboardResponse } | null>(
    null,
  )
  const [failed, setFailed] = useState<{ day: string | null; message: string } | null>(null)
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    client
      .board(day ?? undefined, mode)
      .then((b) => {
        if (cancelled) return
        setLoaded({ day, board: b })
        if (day === null) setToday(b.day)
      })
      .catch((e: Error) => !cancelled && setFailed({ day, message: e.message }))
    return () => {
      cancelled = true
    }
  }, [client, day, mode])
  const board = loaded && loaded.day === day ? loaded.board : null
  const error = failed && failed.day === day ? failed.message : null
  const shown = board?.day ?? day ?? today
  const isToday = day === null || (today !== null && day === today)
  const canBack = shown !== null && shown > FIRST_BOARD_DAY
  const canForward = !isToday
  const back = () => shown && setDay(addDays(shown, -1))
  const forward = () => {
    if (!shown || !today) return
    const next = addDays(shown, 1)
    setDay(next >= today ? null : next)
  }
  const youOutside = board?.you && !board.rows.some((r) => r.you) ? board.you : null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${mode === 'nba' ? 'NBA' : 'NFL'} leaderboard`}
      data-testid="leaderboard"
      className="fixed inset-0 z-20 flex flex-col bg-ink/95 p-4 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 overflow-hidden">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-3xl font-black uppercase tracking-tight">
              {isToday ? "Today's leaderboard" : 'Leaderboard'}
            </h2>
            {onMode && (
              <div
                role="radiogroup"
                aria-label="Sport"
                data-testid="board-sport"
                className="my-1 inline-flex rounded-xl border border-white/15 p-0.5 text-xs font-bold"
              >
                {(['probowl', 'nba'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => onMode(m)}
                    data-testid={`board-mode-${m}`}
                    className={
                      'min-h-[32px] rounded-lg px-3 ' +
                      (mode === m ? 'bg-white text-ink' : 'text-white/70')
                    }
                  >
                    {m === 'nba' ? 'NBA' : 'NFL'}
                  </button>
                ))}
              </div>
            )}
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/50">
              <button
                type="button"
                onClick={back}
                disabled={!canBack}
                aria-label="Previous day"
                data-testid="board-prev"
                className="min-h-[32px] min-w-[32px] rounded-lg border border-white/15 text-base text-white/80 disabled:opacity-25"
              >
                ‹
              </button>
              <span data-testid="board-day">
                {board
                  ? `${formatDay(board.day)} · ${board.rounds.toLocaleString()} rounds played`
                  : shown
                    ? formatDay(shown)
                    : ' '}
              </span>
              <button
                type="button"
                onClick={forward}
                disabled={!canForward}
                aria-label="Next day"
                data-testid="board-next"
                className="min-h-[32px] min-w-[32px] rounded-lg border border-white/15 text-base text-white/80 disabled:opacity-25"
              >
                ›
              </button>
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
              {isToday
                ? 'Nobody has posted a streak yet today. Yours could be first.'
                : 'No streaks were posted that day.'}
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

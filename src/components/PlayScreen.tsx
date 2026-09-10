import { useEffect, useState } from 'react'
import type { Bundle } from '../game/bundle'
import { share, type ShareResult } from '../share/share'
import type { GameApi } from '../state/useGame'
import { FaceCards } from './FaceCards'
import { OptionCards } from './OptionCards'
import { describeValue } from '../game/probowl'
import { TimerBar } from './TimerBar'
import { Wheels } from './Wheels'
import { MuteButton } from './MuteButton'
import { Announcer } from './Announcer'
import { wheelValue } from './Wheels'
import { SignUpForm } from './SignUpForm'
import type { LeaderboardApi } from '../leaderboard/useLeaderboard'

interface Props {
  bundle: Bundle
  game: GameApi
  imageBaseUrl: string
  siteUrl: string
  leaderboard: LeaderboardApi
  onOpenBoard: () => void
}

const SHARE_FORMAT: Record<ShareResult, 'native' | 'clipboard' | 'failed' | 'cancelled'> = {
  shared: 'native',
  copied: 'clipboard',
  cancelled: 'cancelled',
  failed: 'failed',
}

const TOAST: Record<ShareResult, string | null> = {
  shared: null,
  copied: 'Copied to clipboard',
  cancelled: null,
  failed: 'Could not share',
}

export function PlayScreen({
  bundle,
  game,
  imageBaseUrl,
  siteUrl,
  leaderboard,
  onOpenBoard,
}: Props) {
  const { state, config } = game
  const round = state.round
  const over = state.phase === 'gameover'
  const roll = round ? config.wheels.map((w) => wheelValue(bundle, w.kind, round)).join(' · ') : ''
  const [toast, setToast] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])
  const onShare = async () => {
    if (sharing) return
    setSharing(true)
    const result = await share({ streak: state.streak, roll: roll || null, url: siteUrl })
    setSharing(false)
    game.analytics.track('share_clicked', { format: SHARE_FORMAT[result] })
    setToast(TOAST[result])
  }

  return (
    <main className="mx-auto flex min-h-full max-w-[720px] flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="text-sm uppercase tracking-widest text-white/50">
          Streak{' '}
          <span
            key={state.streak}
            data-testid="streak"
            className="font-display inline-block text-4xl font-black text-accent motion-safe:animate-[pop_300ms_ease-out]"
          >
            {state.streak}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs uppercase tracking-widest text-white/40">
            Best {state.bestStreak}
          </div>
          <MuteButton muted={game.muted} onToggle={game.toggleMute} />
        </div>
      </header>

      <Wheels
        key={state.roundIndex}
        bundle={bundle}
        config={config}
        round={round}
        spinning={state.phase === 'spinning'}
        onLand={game.onWheelLand}
      />

      <TimerBar
        revealAt={state.revealAt}
        decisionMs={config.decisionMs}
        frozen={state.phase !== 'awaiting'}
      />
      <Announcer
        revealAt={state.phase === 'awaiting' ? state.revealAt : null}
        decisionMs={config.decisionMs}
        message={
          state.phase === 'correct'
            ? `Correct. Streak ${state.streak}.`
            : over
              ? `${state.lastOutcome === 'timeout' ? 'Time ran out' : 'Wrong'}. The answer was ${
                  round?.kind === 'faces'
                    ? bundle.people[round.combo.answer]?.name
                    : round && bundle.probowl
                      ? describeValue(bundle.probowl, round.combo.category, round.combo.answer)
                      : ''
                }. Streak ${state.streak}.`
              : null
        }
      />

      {round && round.kind === 'faces' && state.phase !== 'spinning' ? (
        <FaceCards
          bundle={bundle}
          round={round}
          state={state}
          onTap={game.tap}
          onPainted={game.onPainted}
          imageBaseUrl={imageBaseUrl}
        />
      ) : round && round.kind === 'probowl' && state.phase !== 'spinning' ? (
        <OptionCards
          bundle={bundle}
          round={round}
          state={state}
          onTap={game.tap}
          onPainted={game.onPainted}
          assetBaseUrl={import.meta.env.BASE_URL}
        />
      ) : (
        <div className="grid grid-cols-3 gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="aspect-[1/1.25] rounded-xl border-4 border-white/5 bg-card/50"
            />
          ))}
        </div>
      )}

      {over && (
        <section
          data-testid="game-over"
          data-roll={roll || undefined}
          className="mt-auto flex flex-col gap-3 rounded-2xl border border-white/10 bg-card p-4 text-center"
        >
          {/* Frank (2026-09-09): nothing above the number; the roll lives in data-roll for the share card and tests. */}
          <p className="font-display text-6xl font-black text-accent" data-testid="final-streak">
            {state.streak}
          </p>
          <p className="text-xs uppercase tracking-widest text-white/50">Best {state.bestStreak}</p>
          {leaderboard.needsSignUp ? (
            // First streak on this device: the email gate replaces the buttons (decision 0008).
            <SignUpForm onSubmit={leaderboard.signUp} />
          ) : (
            <>
              <p
                data-testid="rank-line"
                className="min-h-[20px] text-sm font-bold uppercase tracking-widest text-white/70"
              >
                {leaderboard.posted && leaderboard.posted.rank > 0
                  ? `You're #${leaderboard.posted.rank} on today's leaderboard`
                  : leaderboard.postError
                    ? leaderboard.postError
                    : leaderboard.identity
                      ? 'Posting your streak…'
                      : ''}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={onShare}
                  disabled={sharing}
                  data-testid="share"
                  className="min-h-[52px] rounded-2xl border-2 border-white/20 px-2 text-base font-black text-white active:scale-95 disabled:opacity-60"
                >
                  Share
                </button>
                <button
                  type="button"
                  onClick={onOpenBoard}
                  data-testid="open-board"
                  className="min-h-[52px] rounded-2xl border-2 border-white/20 px-2 text-base font-black text-white active:scale-95"
                >
                  Leaderboard
                </button>
                <button
                  type="button"
                  onClick={game.start}
                  className="min-h-[52px] rounded-2xl bg-accent px-2 text-base font-black text-ink active:scale-95"
                >
                  Play again
                </button>
              </div>
            </>
          )}
          {toast && (
            <p role="status" data-testid="toast" className="text-xs text-white/60">
              {toast}
            </p>
          )}
        </section>
      )}
    </main>
  )
}

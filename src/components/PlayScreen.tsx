import { poolOf, type Bundle } from '../game/bundle'
import { GAME_TITLE } from '../game/config'
import { ShareButton } from './ShareButton'
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

/** What the Share button reads for a moment after a tap (Frank, 2026-09-09: the button itself answers). */
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
  const roll = round
    ? config.wheels.map((w) => wheelValue(bundle, w.kind, round, config.poolKey)).join(' · ')
    : ''

  return (
    <main className="mx-auto flex min-h-full max-w-[720px] flex-col gap-4 p-4">
      {/* Three columns so the streak sits centred above the middle wheel (Frank, 2026-09-10). */}
      <header className="grid grid-cols-3 items-center">
        <button
          type="button"
          onClick={game.home}
          data-testid="home"
          aria-label="Spin Streak home"
          className="font-display justify-self-start min-h-[44px] text-lg font-black uppercase tracking-tight text-white active:opacity-70"
        >
          {GAME_TITLE}
        </button>
        <div className="justify-self-center">
          <span
            key={state.streak}
            data-testid="streak"
            aria-label={`Streak ${state.streak}`}
            className="font-display inline-block text-4xl font-black text-accent motion-safe:animate-[pop_300ms_ease-out]"
          >
            {state.streak}
          </span>
        </div>
        <div className="flex items-center justify-self-end gap-3">
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
                    : round && poolOf(bundle, config.poolKey)
                      ? describeValue(
                          poolOf(bundle, config.poolKey)!,
                          round.combo.category,
                          round.combo.answer,
                        )
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
          poolKey={config.poolKey}
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
                <ShareButton
                  payload={{ streak: state.streak, roll: roll || null, url: siteUrl }}
                  analytics={game.analytics}
                  className="min-h-[52px] px-2 text-base"
                />
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
        </section>
      )}
    </main>
  )
}

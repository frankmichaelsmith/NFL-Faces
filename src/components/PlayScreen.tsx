import type { Bundle } from '../game/bundle'
import type { GameApi } from '../state/useGame'
import { FaceCards } from './FaceCards'
import { TimerBar } from './TimerBar'
import { Wheels } from './Wheels'
import { wheelValue } from './Wheels'

interface Props {
  bundle: Bundle
  game: GameApi
  imageBaseUrl: string
}

export function PlayScreen({ bundle, game, imageBaseUrl }: Props) {
  const { state, config } = game
  const round = state.round
  const over = state.phase === 'gameover'
  const roll = round ? config.wheels.map((w) => wheelValue(bundle, w.kind, round)).join(' · ') : ''

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
        <div className="text-xs uppercase tracking-widest text-white/40">
          Best {state.bestStreak}
        </div>
      </header>

      <Wheels
        key={state.roundIndex}
        bundle={bundle}
        config={config}
        round={round}
        spinning={state.phase === 'spinning'}
      />

      <TimerBar
        revealAt={state.revealAt}
        decisionMs={config.decisionMs}
        frozen={state.phase !== 'awaiting'}
      />

      {round && state.phase !== 'spinning' ? (
        <FaceCards
          bundle={bundle}
          round={round}
          state={state}
          onTap={game.tap}
          onPainted={game.onPainted}
          imageBaseUrl={imageBaseUrl}
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
          className="mt-auto flex flex-col gap-3 rounded-2xl border border-white/10 bg-card p-4 text-center"
        >
          <p className="text-xs uppercase tracking-widest text-white/50">
            {state.lastOutcome === 'timeout'
              ? 'Time ran out'
              : state.lastOutcome === 'exhausted'
                ? 'You cleared every quarterback'
                : 'Wrong face'}
          </p>
          {roll && (
            <p className="text-sm text-white/70" data-testid="losing-roll">
              Died on <span className="font-bold text-white">{roll}</span>
            </p>
          )}
          <p className="font-display text-6xl font-black text-accent" data-testid="final-streak">
            {state.streak}
          </p>
          <p className="text-xs uppercase tracking-widest text-white/50">Best {state.bestStreak}</p>
          <button
            type="button"
            onClick={game.start}
            className="min-h-[52px] rounded-2xl bg-accent px-6 text-lg font-black text-ink active:scale-95"
          >
            New streak
          </button>
        </section>
      )}
    </main>
  )
}

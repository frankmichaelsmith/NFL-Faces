import { useState } from 'react'
import { GAME_TITLE, MODE_LABELS, VISIBLE_MODES, type Mode } from '../game/config'
import { MuteButton } from './MuteButton'
import { SignUpForm } from './SignUpForm'
import { ShareButton } from './ShareButton'
import type { DailyBest } from '../storage/local'
import type { Analytics } from '../analytics/analytics'

interface Props {
  mode: Mode
  onMode: (m: Mode) => void
  /** Visible modes the bundle cannot serve (greyed out). */
  unavailable: readonly Mode[]
  /** Today's best in this mode, or null when the device has not played today. */
  today: DailyBest | null
  /** Address printed at the end of the share text. */
  siteUrl: string
  analytics: Analytics
  onStart: () => void
  muted: boolean
  onToggleMute: () => void
  /** Played once with no email on file: Start opens the sign-up form first (decision 0008). */
  needsSignUp: boolean
  onSignUp: (email: string, name: string) => Promise<string | null>
  onOpenBoard: () => void
}

export function StartScreen({
  mode,
  onMode,
  unavailable,
  today,
  siteUrl,
  analytics,
  onStart,
  muted,
  onToggleMute,
  needsSignUp,
  onSignUp,
  onOpenBoard,
}: Props) {
  const [gate, setGate] = useState(false)
  return (
    <main className="relative mx-auto flex min-h-full max-w-[720px] flex-col items-center justify-center gap-6 p-6 text-center">
      <MuteButton muted={muted} onToggle={onToggleMute} className="absolute right-4 top-4" />
      <h1 className="font-display text-7xl font-black uppercase tracking-tight">{GAME_TITLE}</h1>
      {VISIBLE_MODES.length > 1 && (
        // The sport slider (Frank, 2026-09-10): a pill that slides under NFL | NBA.
        <div
          role="radiogroup"
          aria-label="Sport"
          className="relative grid w-56 rounded-2xl border border-white/15 bg-black/30 p-1 text-base font-black"
          style={{ gridTemplateColumns: `repeat(${VISIBLE_MODES.length}, minmax(0, 1fr))` }}
          data-testid="mode-picker"
        >
          <span
            aria-hidden
            className="absolute bottom-1 top-1 rounded-xl bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              width: `calc((100% - 0.5rem) / ${VISIBLE_MODES.length})`,
              left: '0.25rem',
              transform: `translateX(${Math.max(0, VISIBLE_MODES.indexOf(mode)) * 100}%)`,
            }}
          />
          {VISIBLE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={unavailable.includes(m)}
              onClick={() => onMode(m)}
              data-testid={`mode-${m}`}
              className={
                'relative z-10 min-h-[44px] rounded-xl px-4 uppercase tracking-wide transition-colors disabled:opacity-40 ' +
                (mode === m ? 'text-ink' : 'text-white/70')
              }
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      <p className="max-w-xs text-lg text-white/70">
        {mode !== 'faces' ? (
          // Frank (2026-09-09): two centred lines, fixed break, no full stop.
          <>
            Tap the correct answer
            <br />
            in 6 seconds or less
          </>
        ) : (
          'Tap the quarterback who started for that team that season. Six seconds.'
        )}
      </p>
      {needsSignUp && gate ? (
        <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-card p-4">
          <SignUpForm
            onSubmit={async (email, name) => {
              const err = await onSignUp(email, name)
              if (!err) onStart()
              return err
            }}
          />
        </div>
      ) : (
        <div className="flex w-full max-w-xs gap-3">
          {today && (
            // Played today: share the day's top streak from here too (Frank, 2026-09-09).
            <ShareButton
              payload={{ streak: today.best_streak, roll: today.best_streak_roll, url: siteUrl }}
              analytics={analytics}
              className="min-h-[56px] flex-1 px-4 text-lg"
              testId="start-share"
              label="Share Score"
            />
          )}
          <button
            type="button"
            onClick={needsSignUp ? () => setGate(true) : onStart}
            className="min-h-[56px] flex-1 rounded-2xl bg-accent px-6 text-xl font-black text-ink active:scale-95"
          >
            {today ? 'Play Again' : 'Start'}
          </button>
        </div>
      )}
      {today && (
        <p className="text-sm uppercase tracking-widest text-white/50" data-testid="best">
          Your top streak of the day:{' '}
          <span className="font-black text-accent">{today.best_streak}</span>
        </p>
      )}
      <button
        type="button"
        onClick={onOpenBoard}
        data-testid="open-board"
        className="min-h-[44px] rounded-xl px-4 text-sm font-bold uppercase tracking-widest text-white/60 underline decoration-white/40 underline-offset-4 hover:decoration-white"
      >
        Today&apos;s leaderboard
      </button>
      <a
        href="/attribution.html"
        className="absolute bottom-4 text-xs text-white/35 underline-offset-2 hover:underline"
      >
        Photo credits
      </a>
    </main>
  )
}

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
  proBowlAvailable: boolean
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
  proBowlAvailable,
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
        <div
          role="radiogroup"
          aria-label="Game mode"
          className="flex rounded-2xl border border-white/15 p-1 text-sm font-bold"
          data-testid="mode-picker"
        >
          {VISIBLE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={m === 'probowl' && !proBowlAvailable}
              onClick={() => onMode(m)}
              data-testid={`mode-${m}`}
              className={
                'min-h-[44px] rounded-xl px-5 disabled:opacity-40 ' +
                (mode === m ? 'bg-white text-ink' : 'text-white/70')
              }
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      <p className="max-w-xs text-lg text-white/70">
        {mode === 'probowl' ? (
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
      {today && (
        <p className="text-sm uppercase tracking-widest text-white/50" data-testid="best">
          Your top streak of the day:{' '}
          <span className="font-black text-accent">{today.best_streak}</span>
        </p>
      )}
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
          <button
            type="button"
            onClick={needsSignUp ? () => setGate(true) : onStart}
            className="min-h-[56px] flex-1 rounded-2xl bg-accent px-8 text-xl font-black text-ink active:scale-95"
          >
            Start
          </button>
          {today && (
            // Played today: share the day's top streak from here too (Frank, 2026-09-09).
            <ShareButton
              payload={{ streak: today.best_streak, roll: today.best_streak_roll, url: siteUrl }}
              analytics={analytics}
              className="min-h-[56px] basis-2/5 px-4 text-lg"
              testId="start-share"
            />
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onOpenBoard}
        data-testid="open-board"
        className="min-h-[44px] rounded-xl px-4 text-sm font-bold uppercase tracking-widest text-white/60 underline-offset-4 hover:underline"
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

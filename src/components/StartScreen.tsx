import { MuteButton } from './MuteButton'

interface Props {
  bestStreak: number
  bestStreakRoll?: string | null
  onStart: () => void
  muted: boolean
  onToggleMute: () => void
}

export function StartScreen({ bestStreak, bestStreakRoll, onStart, muted, onToggleMute }: Props) {
  return (
    <main className="relative mx-auto flex min-h-full max-w-[720px] flex-col items-center justify-center gap-6 p-6 text-center">
      <MuteButton muted={muted} onToggle={onToggleMute} className="absolute right-4 top-4" />
      <h1 className="font-display text-7xl font-black uppercase tracking-tight">NFL Faces</h1>
      <p className="max-w-xs text-lg text-white/70">
        Tap the quarterback who started for that team that season.
      </p>
      {bestStreak > 0 && (
        <p className="text-sm uppercase tracking-widest text-white/50" data-testid="best">
          Best streak <span className="font-black text-accent">{bestStreak}</span>
          {bestStreakRoll ? (
            <span className="text-white/40"> · died on {bestStreakRoll}</span>
          ) : null}
        </p>
      )}
      <button
        type="button"
        onClick={onStart}
        className="min-h-[56px] w-full max-w-xs rounded-2xl bg-accent px-8 text-xl font-black text-ink active:scale-95"
      >
        Start
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

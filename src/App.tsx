import { useEffect, useState } from 'react'
import { PlayScreen } from './components/PlayScreen'
import { StartScreen } from './components/StartScreen'
import type { Bundle } from './game/bundle'
import { type GameConfig, type Mode } from './game/config'
import { defaultRng, mulberry32, type Rng } from './game/rng'
import { useGame, type GameDeps } from './state/useGame'
import { loadStats, saveStats, setLastMode } from './storage/local'

const IMAGE_BASE_URL = (import.meta.env.VITE_IMAGE_BASE_URL as string | undefined) ?? '/faces/'
/** Public URL printed on share cards. Falls back to wherever the page is served from. */
export const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined) ??
  (typeof location !== 'undefined' ? location.origin : 'https://nflfaces.app')

interface Props {
  /** Injected in tests; otherwise fetched from /data/bundle.json. */
  bundle?: Bundle
  rng?: Rng
  deps?: GameDeps
  /** Initial mode; defaults to the last one chosen on this device. */
  mode?: Mode
  /** Timing/config overrides (tests). */
  config?: Partial<GameConfig>
}

/** `?seed=123` makes a run reproducible (debugging, e2e). Production play stays random. */
function rngFromLocation(): Rng | null {
  if (typeof location === 'undefined') return null
  const seed = new URLSearchParams(location.search).get('seed')
  return seed && /^\d+$/.test(seed) ? mulberry32(Number(seed)) : null
}

export default function App({
  bundle: given,
  rng = rngFromLocation() ?? defaultRng,
  deps = {},
  mode: initialMode,
  config,
}: Props) {
  const [mode, setMode] = useState<Mode>(() => initialMode ?? loadStats().last_mode)
  const [bundle, setBundle] = useState<Bundle | null>(given ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (given) return
    fetch(`${import.meta.env.BASE_URL}data/bundle.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Bundle) => setBundle(b))
      .catch((e: Error) => setError(e.message))
  }, [given])

  if (error) return <Center>Could not load the game data ({error}).</Center>
  if (!bundle) return <Center>Loading…</Center>
  const chooseMode = (m: Mode) => {
    saveStats(setLastMode(loadStats(), m))
    setMode(m)
  }
  return (
    <Game
      key={mode}
      bundle={bundle}
      mode={mode}
      rng={rng}
      deps={deps}
      onMode={chooseMode}
      overrides={config}
    />
  )
}

function Game({
  bundle,
  mode,
  rng,
  deps,
  onMode,
  overrides,
}: {
  bundle: Bundle
  mode: Mode
  rng: Rng
  deps: GameDeps
  onMode: (m: Mode) => void
  overrides?: Partial<GameConfig>
}) {
  const game = useGame(bundle, mode, rng, IMAGE_BASE_URL, deps, overrides)
  if (game.state.phase === 'idle')
    return (
      <StartScreen
        mode={mode}
        onMode={onMode}
        proBowlAvailable={!!bundle.probowl}
        bestStreak={game.stats.modes[mode].best_streak}
        bestStreakRoll={game.stats.modes[mode].best_streak_roll}
        onStart={game.start}
        muted={game.muted}
        onToggleMute={game.toggleMute}
      />
    )
  return (
    <PlayScreen bundle={bundle} game={game} imageBaseUrl={game.imageBaseUrl} siteUrl={SITE_URL} />
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-white/60">{children}</div>
}

import { useEffect, useState } from 'react'
import { PlayScreen } from './components/PlayScreen'
import { StartScreen } from './components/StartScreen'
import type { Bundle } from './game/bundle'
import { GAME_CONFIG, type GameConfig } from './game/config'
import { defaultRng, type Rng } from './game/rng'
import { useGame, type GameDeps } from './state/useGame'
import { wheelValue } from './components/Wheels'
import type { GameState } from './state/machine'

const IMAGE_BASE_URL = (import.meta.env.VITE_IMAGE_BASE_URL as string | undefined) ?? '/faces/'
/** Public URL printed on share cards. Falls back to wherever the page is served from. */
export const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined) ??
  (typeof location !== 'undefined' ? location.origin : 'https://nflfaces.app')

interface Props {
  /** Injected in tests; otherwise fetched from /data/bundle.json. */
  bundle?: Bundle
  config?: GameConfig
  rng?: Rng
  deps?: GameDeps
}

export default function App({
  bundle: given,
  config = GAME_CONFIG,
  rng = defaultRng,
  deps = {},
}: Props) {
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
  return <Game bundle={bundle} config={config} rng={rng} deps={deps} />
}

function Game({
  bundle,
  config,
  rng,
  deps,
}: {
  bundle: Bundle
  config: GameConfig
  rng: Rng
  deps: GameDeps
}) {
  const rollLabel = (s: GameState) =>
    s.round ? config.wheels.map((w) => wheelValue(bundle, w.kind, s.round!)).join(' · ') : null
  const game = useGame(bundle, config, rng, IMAGE_BASE_URL, rollLabel, deps)
  if (game.state.phase === 'idle')
    return (
      <StartScreen
        bestStreak={game.stats.best_streak}
        bestStreakRoll={game.stats.best_streak_roll}
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

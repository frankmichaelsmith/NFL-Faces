import { useEffect, useState } from 'react'
import { PlayScreen } from './components/PlayScreen'
import { StartScreen } from './components/StartScreen'
import type { Bundle } from './game/bundle'
import { GAME_CONFIG, type GameConfig } from './game/config'
import { defaultRng, type Rng } from './game/rng'
import { useGame } from './state/useGame'

const IMAGE_BASE_URL = (import.meta.env.VITE_IMAGE_BASE_URL as string | undefined) ?? '/faces/'

interface Props {
  /** Injected in tests; otherwise fetched from /data/bundle.json. */
  bundle?: Bundle
  config?: GameConfig
  rng?: Rng
}

export default function App({ bundle: given, config = GAME_CONFIG, rng = defaultRng }: Props) {
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
  return <Game bundle={bundle} config={config} rng={rng} />
}

function Game({ bundle, config, rng }: { bundle: Bundle; config: GameConfig; rng: Rng }) {
  const game = useGame(bundle, config, rng, IMAGE_BASE_URL)
  if (game.state.phase === 'idle')
    return <StartScreen bestStreak={game.state.bestStreak} onStart={game.start} />
  return <PlayScreen bundle={bundle} game={game} imageBaseUrl={game.imageBaseUrl} />
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-white/60">{children}</div>
}

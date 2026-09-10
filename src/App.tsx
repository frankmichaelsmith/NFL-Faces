import { useEffect, useState } from 'react'
import { PlayScreen } from './components/PlayScreen'
import { StartScreen } from './components/StartScreen'
import type { Bundle } from './game/bundle'
import { VISIBLE_MODES, type GameConfig, type Mode } from './game/config'
import { createLeaderboardClient, type LeaderboardClient } from './leaderboard/client'
import { useLeaderboard } from './leaderboard/useLeaderboard'
import { useBoardRoute } from './leaderboard/route'
import { LeaderboardScreen } from './components/LeaderboardScreen'
import { defaultRng, mulberry32, type Rng } from './game/rng'
import { useGame, type GameDeps } from './state/useGame'
import { loadStats, saveStats, setLastMode, todayBest, type DailyBest } from './storage/local'

const IMAGE_BASE_URL = (import.meta.env.VITE_IMAGE_BASE_URL as string | undefined) ?? '/faces/'
/**
 * Address printed at the end of every share (Frank, 2026-09-09). A constant on
 * purpose: the Vercel project still carries an old VITE_SITE_URL, and the share
 * must read www.spinstreak.app wherever the game is served from.
 */
export const SITE_URL = 'https://www.spinstreak.app'

interface Props {
  /** Injected in tests; otherwise fetched from /data/bundle.json. */
  bundle?: Bundle
  rng?: Rng
  deps?: GameDeps & { leaderboard?: LeaderboardClient }
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

/** `?mode=faces` opens a hidden mode (debugging, e2e). */
function modeFromLocation(): Mode | null {
  const m = new URLSearchParams(location.search).get('mode')
  return m === 'faces' || m === 'probowl' ? m : null
}

export default function App({
  bundle: given,
  rng = rngFromLocation() ?? defaultRng,
  deps = {},
  mode: initialMode,
  config,
}: Props) {
  const forced = initialMode ?? modeFromLocation()
  const [mode, setMode] = useState<Mode>(() => forced ?? loadStats().last_mode)
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
  // A remembered or hidden mode only plays if the bundle can serve it and it is on offer (or forced).
  const available = (m: Mode) => m === 'faces' || !!bundle.probowl
  const effective =
    (mode === forced || VISIBLE_MODES.includes(mode)) && available(mode)
      ? mode
      : (VISIBLE_MODES.find(available) ?? 'faces')
  return (
    <Game
      key={effective}
      bundle={bundle}
      mode={effective}
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
  deps: GameDeps & { leaderboard?: LeaderboardClient }
  onMode: (m: Mode) => void
  overrides?: Partial<GameConfig>
}) {
  const game = useGame(bundle, mode, rng, IMAGE_BASE_URL, deps, overrides)
  const [client] = useState(() => deps.leaderboard ?? createLeaderboardClient())
  const lb = useLeaderboard(game, client)
  const route = useBoardRoute()
  const openBoard = (from: 'start' | 'gameover') => {
    game.analytics.track('leaderboard_opened', { from })
    route.openBoard()
  }
  const board = route.open ? (
    <LeaderboardScreen client={client} signedIn={!!lb.identity} onClose={route.closeBoard} />
  ) : null
  if (game.state.phase === 'idle')
    return (
      <>
        <StartScreen
          mode={mode}
          onMode={onMode}
          proBowlAvailable={!!bundle.probowl}
          today={todayFor(game.stats, mode, lb.dayBest)}
          siteUrl={SITE_URL}
          analytics={game.analytics}
          onStart={game.start}
          muted={game.muted}
          onToggleMute={game.toggleMute}
          needsSignUp={lb.needsSignUp}
          onSignUp={lb.signUp}
          onOpenBoard={() => openBoard('start')}
        />
        {board}
      </>
    )
  return (
    <>
      <PlayScreen
        bundle={bundle}
        game={game}
        imageBaseUrl={game.imageBaseUrl}
        siteUrl={SITE_URL}
        leaderboard={lb}
        onOpenBoard={() => openBoard('gameover')}
      />
      {board}
    </>
  )
}

/** Today's best for the home screen: the server's number when it knows more than this device does. */
function todayFor(
  stats: Parameters<typeof todayBest>[0],
  mode: Mode,
  server: { streak: number; roll: string | null } | null,
): DailyBest | null {
  const local = todayBest(stats, mode)
  if (server && (!local || server.streak > local.best_streak))
    return {
      day: local?.day ?? '',
      best_streak: server.streak,
      best_streak_roll: server.roll,
      games: local?.games ?? 1,
    }
  return local
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-white/60">{children}</div>
}

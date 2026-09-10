/**
 * The leaderboard lives at /leaderboard (NFL) and /leaderboard/nba (Frank,
 * 2026-09-09/10) so the browser's Back button returns to the game and each
 * sport's board has its own address. Opening pushes a history entry; closing
 * goes back (or rewrites the address when the page was opened there directly).
 */
import { useCallback, useEffect, useState } from 'react'

export type BoardMode = 'probowl' | 'nba'
export const BOARD_PATH = '/leaderboard'

/** The sport a board path names, or null when the path is not a board. */
export function boardModeOf(pathname: string): BoardMode | null {
  const m = pathname.replace(/\/$/, '').match(/^\/leaderboard(?:\/(nfl|nba))?$/)
  if (!m) return null
  return m[1] === 'nba' ? 'nba' : 'probowl'
}
export function boardPath(mode: BoardMode): string {
  return mode === 'nba' ? `${BOARD_PATH}/nba` : BOARD_PATH
}

const current = (): BoardMode | null =>
  typeof location !== 'undefined' ? boardModeOf(location.pathname) : null

export function useBoardRoute(): {
  open: boolean
  mode: BoardMode
  openBoard: (mode: BoardMode) => void
  /** Switch sport while open: rewrites the address in place (no new history entry). */
  setMode: (mode: BoardMode) => void
  closeBoard: () => void
} {
  const [state, setState] = useState<{ open: boolean; mode: BoardMode }>(() => {
    const m = current()
    return { open: m !== null, mode: m ?? 'probowl' }
  })
  useEffect(() => {
    const onPop = () => {
      const m = current()
      setState({ open: m !== null, mode: m ?? 'probowl' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openBoard = useCallback((mode: BoardMode) => {
    if (current() === null)
      history.pushState({ board: true }, '', boardPath(mode) + location.search)
    else history.replaceState(history.state, '', boardPath(mode) + location.search)
    setState({ open: true, mode })
  }, [])
  const setMode = useCallback((mode: BoardMode) => {
    history.replaceState(history.state, '', boardPath(mode) + location.search)
    setState({ open: true, mode })
  }, [])
  const closeBoard = useCallback(() => {
    if (history.state && (history.state as { board?: boolean }).board) history.back()
    else history.replaceState(null, '', '/' + location.search)
    setState((s) => ({ ...s, open: false }))
  }, [])
  return { open: state.open, mode: state.mode, openBoard, setMode, closeBoard }
}

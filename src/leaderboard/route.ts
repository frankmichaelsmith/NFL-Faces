/**
 * The leaderboard lives at /leaderboard (Frank, 2026-09-09) so the browser's
 * Back button returns to the game. Opening pushes a history entry; closing
 * goes back (or rewrites the address when the page was opened there directly).
 */
import { useCallback, useEffect, useState } from 'react'

export const BOARD_PATH = '/leaderboard'

const atBoard = () =>
  typeof location !== 'undefined' && location.pathname.replace(/\/$/, '') === BOARD_PATH

export function useBoardRoute(): { open: boolean; openBoard: () => void; closeBoard: () => void } {
  const [open, setOpen] = useState<boolean>(atBoard)
  useEffect(() => {
    const onPop = () => setOpen(atBoard())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openBoard = useCallback(() => {
    if (!atBoard()) history.pushState({ board: true }, '', BOARD_PATH + location.search)
    setOpen(true)
  }, [])
  const closeBoard = useCallback(() => {
    if (history.state && (history.state as { board?: boolean }).board) history.back()
    else history.replaceState(null, '', '/' + location.search)
    setOpen(false)
  }, [])
  return { open, openBoard, closeBoard }
}

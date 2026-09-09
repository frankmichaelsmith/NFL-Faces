/** Diagnostic probe (temporary): extension-less relative import. */
import { etDay } from '../server/leaderboard'
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'import-no-ext', day: etDay(new Date()) }), {
    headers: { 'content-type': 'application/json' },
  })
}

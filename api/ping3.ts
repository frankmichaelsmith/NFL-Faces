/** Diagnostic probe (temporary): relative import with a .ts extension. */
import { etDay } from '../server/leaderboard.ts'
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'import-ts-ext', day: etDay(new Date()) }), {
    headers: { 'content-type': 'application/json' },
  })
}

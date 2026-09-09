/** Vercel Function: /api/leaderboard. All logic lives in server/. */
import { route } from '../server/http.ts'
import { getRuntime } from '../server/runtime.ts'

export async function GET(request: Request): Promise<Response> {
  return route(request, await getRuntime())
}

/** Vercel Function: /api/stats. All logic lives in server/. */
import { route } from '../server/http.js'
import { getRuntime } from '../server/runtime.js'

export async function GET(request: Request): Promise<Response> {
  return route(request, await getRuntime())
}

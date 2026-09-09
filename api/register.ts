/** Vercel Function: /api/register. All logic lives in server/. */
import { route } from '../server/http.js'
import { getRuntime } from '../server/runtime.js'

export async function POST(request: Request): Promise<Response> {
  return route(request, await getRuntime())
}

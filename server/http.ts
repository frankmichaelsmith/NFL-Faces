/**
 * HTTP layer over the leaderboard handlers, on the Web standard Request /
 * Response so the same code runs as a Vercel Function (api/*.ts), in the Vite
 * dev and preview servers (server/vite-plugin.ts) and in tests.
 */
import type { HealthResponse } from '../src/leaderboard/types.js'
import {
  etDay,
  leaderboard,
  postScore,
  register,
  stats,
  type Deps,
  type Result,
} from './leaderboard.js'
import type { Runtime } from './runtime.js'

const VERSION =
  process.env.VITE_BUILD_HASH || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev'

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
const reply = (r: Result<unknown>) => json(r.status, r.body)

export function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? ''
  const m = h.match(/^Bearer\s+(\S+)$/i)
  return m ? m[1]! : null
}

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/** Route one request. Unknown paths and methods get 404 / 405 JSON, never HTML. */
export async function route(
  request: Request,
  runtime: Runtime,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const url = new URL(request.url)
  const deps: Deps = { store: runtime.store, now }
  const path = url.pathname.replace(/\/+$/, '')
  try {
    switch (path) {
      case '/api/health': {
        if (request.method !== 'GET') return json(405, { error: 'method', message: 'GET only' })
        const h: HealthResponse = {
          ok: true,
          store: runtime.kind,
          day: etDay(now()),
          version: VERSION,
        }
        return json(200, h)
      }
      case '/api/register':
        if (request.method !== 'POST') return json(405, { error: 'method', message: 'POST only' })
        return reply(await register(deps, await body(request)))
      case '/api/score':
        if (request.method !== 'POST') return json(405, { error: 'method', message: 'POST only' })
        return reply(await postScore(deps, bearer(request), await body(request)))
      case '/api/leaderboard':
        if (request.method !== 'GET') return json(405, { error: 'method', message: 'GET only' })
        return reply(
          await leaderboard(
            deps,
            bearer(request),
            url.searchParams.get('day'),
            url.searchParams.get('mode'),
          ),
        )
      case '/api/stats':
        if (request.method !== 'GET') return json(405, { error: 'method', message: 'GET only' })
        return reply(await stats(deps, url.searchParams.get('day'), url.searchParams.get('mode')))
      default:
        return json(404, { error: 'not_found', message: `No route ${path}` })
    }
  } catch (e) {
    console.error('leaderboard api', e)
    return json(500, { error: 'server', message: 'Leaderboard unavailable' })
  }
}

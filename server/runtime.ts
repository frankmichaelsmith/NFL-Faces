/**
 * Store wiring for the API: DATABASE_URL set → Neon Postgres over HTTP
 * (production); otherwise the in-memory store (local dev and the preview
 * server — state resets per process). Memoized per serverless instance; a
 * failed init is not memoized, so the next request retries.
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { DrizzleLeaderboardStore, ensureSchema } from './db.ts'
import { InMemoryLeaderboardStore, type LeaderboardStore } from './leaderboard.ts'

export interface Runtime {
  store: LeaderboardStore
  kind: 'neon' | 'memory'
}

let runtime: Promise<Runtime> | null = null

export function getRuntime(): Promise<Runtime> {
  runtime ??= init().catch((e: unknown) => {
    runtime = null
    throw e
  })
  return runtime
}

async function init(): Promise<Runtime> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn('leaderboard: DATABASE_URL not set — in-memory store (dev only)')
    return { store: new InMemoryLeaderboardStore(), kind: 'memory' }
  }
  const db = drizzle(neon(url))
  await ensureSchema(db)
  return { store: new DrizzleLeaderboardStore(db), kind: 'neon' }
}

import { createHash } from 'node:crypto'
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'crypto', h: createHash('sha256').update('x').digest('hex').slice(0, 8) }))
}

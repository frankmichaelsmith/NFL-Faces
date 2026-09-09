import { z } from 'zod'
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'zod', ok: z.string().safeParse('x').success }))
}

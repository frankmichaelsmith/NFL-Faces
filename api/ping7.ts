import { where } from '../server/probe'
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'outside-import', where }))
}

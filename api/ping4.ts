import { where } from './_lib'
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'sibling-import', where }))
}

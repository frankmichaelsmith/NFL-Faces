/** Diagnostic probe (temporary): Web-standard handler with no imports. */
export function GET(): Response {
  return new Response(JSON.stringify({ ping: 'no-imports', node: process.version }), {
    headers: { 'content-type': 'application/json' },
  })
}

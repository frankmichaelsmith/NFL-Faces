/**
 * Performance budget (spec §19): the code + content bundle a first visit
 * downloads must stay small. Run after `npm run build`.
 *
 *   npm run size
 *
 * Fails when the gzipped JS+CSS exceeds BUDGET_APP_KB or the gzipped content
 * bundle exceeds BUDGET_DATA_KB. Faces are fetched lazily and are not counted.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = path.resolve(import.meta.dirname, '../dist')
const BUDGET_APP_KB = 250
const BUDGET_DATA_KB = 1024

async function gz(file: string): Promise<number> {
  return gzipSync(await readFile(file)).length
}

async function main() {
  const assets = path.join(DIST, 'assets')
  const files = await readdir(assets)
  let app = 0
  const rows: [string, number, number][] = []
  for (const f of files) {
    if (!/\.(js|css)$/.test(f)) continue
    const full = path.join(assets, f)
    const raw = (await stat(full)).size
    const z = await gz(full)
    app += z
    rows.push([f, raw, z])
  }
  const data = await gz(path.join(DIST, 'data/bundle.json'))
  const kb = (n: number) => (n / 1024).toFixed(1)
  for (const [f, raw, z] of rows)
    console.log(`  ${f.padEnd(32)} ${kb(raw).padStart(8)} KB  gzip ${kb(z).padStart(7)} KB`)
  console.log(`app (js+css) gzip: ${kb(app)} KB / budget ${BUDGET_APP_KB} KB`)
  console.log(`content bundle gzip: ${kb(data)} KB / budget ${BUDGET_DATA_KB} KB`)
  let bad = false
  if (app > BUDGET_APP_KB * 1024) {
    console.error('BUDGET EXCEEDED: app')
    bad = true
  }
  if (data > BUDGET_DATA_KB * 1024) {
    console.error('BUDGET EXCEEDED: content bundle')
    bad = true
  }
  process.exit(bad ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

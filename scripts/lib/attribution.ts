/**
 * Static photo-credits page (spec §12): every served photo with its source,
 * licence and author where the licence requires one. Written by build:content.
 */
import type { PersonRow } from './content'

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function renderAttribution(people: PersonRow[]): string {
  const commons = people
    .filter((p) => p.photo_source.startsWith('commons:'))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  const espn = people.filter((p) => p.photo_source === 'espn').length
  const manual = people.filter(
    (p) => p.photo_source && !p.photo_source.startsWith('commons:') && p.photo_source !== 'espn',
  )
  const rows = commons
    .map((p) => {
      const file = p.photo_source.slice('commons:'.length)
      const url =
        'https://commons.wikimedia.org/wiki/' + encodeURIComponent(file.replace(/ /g, '_'))
      const author = (p.notes.match(/Photo: ([^;]+)/)?.[1] ?? '').trim()
      return `<tr><td>${esc(p.display_name)}</td><td><a href="${url}">${esc(file.replace(/^File:/, ''))}</a></td><td>${esc(p.photo_license)}</td><td>${esc(author)}</td></tr>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NFL Faces — photo credits</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b1020;color:#fff;margin:0;padding:24px;line-height:1.5}
a{color:#34d399}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);vertical-align:top}
.muted{color:rgba(255,255,255,.6)}
</style></head><body>
<p><a href="/">← Back to the game</a></p>
<h1>Photo credits</h1>
<p class="muted">${espn} player headshots are ESPN headshots. ${manual.length ? `${manual.length} were supplied manually. ` : ''}The following ${commons.length} photographs come from Wikimedia Commons under the licences listed; cropped to the face for the game.</p>
<table><thead><tr><th>Player</th><th>File</th><th>Licence</th><th>Author</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>
`
}

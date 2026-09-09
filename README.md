# NFL Faces

Two wheels land on a season and a team. Tap the quarterback who led that team in passing yards that season. Six seconds. Streak.

Live at https://nfl-faces.vercel.app. Static site, no backend. See `CLAUDE.md` for the working rules and locked decisions, `docs/spec.md` for the original spec.

## Commands

```
npm run dev            # local dev server
npm run pull:espn      # ESPN → content/*.csv (add --refresh to bypass the cache, --samples to refresh /samples)
npm run pull:probowl   # Wikipedia + ESPN → content/probowl_*.csv (Pro Bowl Mode rosters and attributes)
npm run build:content  # CSV → public/data/bundle.json + docs/build-report.md (both modes)
npm run simulate       # 10k-round simulation of the game core
npm test               # unit tests
npm run typecheck
npm run lint
npm run photos         # ESPN/Commons → public/faces/*.jpg (add --sheet for contact sheets)
npm run photos:find    # candidate portraits for anyone still missing a photo → .cache/photos/candidates
npm run icons          # placeholder app icons → public/icons
npm run tiles          # Pro Bowl Mode assets: draft-team tiles → public/tiles, college logos → public/colleges
npm run build          # production build (PWA service worker + manifest included)
npm run size           # gzip budget check on dist/
npm run e2e            # Playwright smoke tests against the production build
```

Copy `.env.example` to `.env` if you need to override defaults; nothing is required for local dev.

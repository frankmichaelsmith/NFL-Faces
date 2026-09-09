# NFL Faces

Two wheels land on a season and a team. Tap the quarterback who led that team in passing yards that season. Five seconds. Streak.

Static site, no backend. See `CLAUDE.md` for the working rules and locked decisions, `docs/spec.md` for the original spec.

## Commands

```
npm run dev            # local dev server
npm run build:content  # CSV → public/data/*.json + build report
npm run simulate       # 10k-round simulation of the game core
npm test               # unit tests
npm run typecheck
npm run lint
npm run build          # production build
```

Copy `.env.example` to `.env` if you need to override defaults; nothing is required for local dev.

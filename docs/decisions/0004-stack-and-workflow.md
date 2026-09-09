# 0004 — Stack, hosting, workflow

**Date:** 2026-09-09 · **Decided by:** Frank

- Data source: ESPN core API (team leaders, athletes, depth charts). nflverse rejected by Frank.
- Hosting: Vercel. Images as static assets behind `VITE_IMAGE_BASE_URL` to start.
- Analytics: spec-shaped event layer with a no-op backend; PostHog later, one-file swap.
- Workflow: commit to `main`, checkpoint per milestone (STREAK CITY style). npm. Project lives next to STREAK CITY in iCloud Documents.
- Current season uses the live depth-chart starter, refreshed weekly.

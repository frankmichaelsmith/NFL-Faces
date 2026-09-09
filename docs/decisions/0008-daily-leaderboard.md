# 0008 — Daily leaderboard with email sign-up

**Date:** 2026-09-09 · **Decided by:** Frank

A daily leaderboard for Pro Bowl Mode. After a player's first streak ends they must add an **email and a display name** before playing again; from then on every streak end posts the score automatically and they can play as often as they like. This overrides the v1 rules "no backend, no database, no auth, no leaderboard" (CLAUDE.md working rule 7, spec §13–14).

**Choices (Frank, 2026-09-09):**

- **Backend:** Neon Postgres + Vercel Functions in this repo (`api/*.ts` → `server/`), the STREAK CITY stack: `@neondatabase/serverless`, `drizzle-orm`, `zod`; PGlite runs the same SQL in tests. Schema is bootstrapped idempotently at start-up (no migration tool). The only secret is `DATABASE_URL` on the Vercel project; unset → in-memory store (local dev, preview, Playwright).
- **Rows show a display name** (2–20 characters), asked with the email. Emails are never shown.
- **No email verification** for now: format check only. Registering an email again renames the player and rotates the token (the previous device is signed out). Anyone can claim any address; accepted for speed.
- **Score:** best streak of the **Eastern calendar day**, one row per player per day, ties broken by who got there first; **top 25** shown, plus the caller's own standing. Resets at midnight ET. Pro Bowl Mode only; Faces scores are stored but never listed.
- **Trust:** scores are client-reported and bounded (integer 0–1000), so a determined cheater can post a fake streak. Server-issued round tokens are a later hardening step if it matters.
- **Privacy:** emails are personal data. A privacy line on the sign-up screen and a privacy policy go on the Ryan/Gabriel legal list. Emails are used for the board and to contact players about the game, nothing else.

**API** (JSON, same origin): `GET /api/health`, `POST /api/register {email,name}` → `{playerId,name,token,day}`, `POST /api/score {streak,roll,mode}` with `Authorization: Bearer <token>` → `{day,best,improved,rank}`, `GET /api/leaderboard?day=` → `{day,rows[25],you,players}`.

**Milestones:** **L1** server (schema, handlers, HTTP routing, Vite dev/preview middleware, tests) · **L2** client (email gate after the first game, automatic score posts with an offline queue, leaderboard screen, e2e).

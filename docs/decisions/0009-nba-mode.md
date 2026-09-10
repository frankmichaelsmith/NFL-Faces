# 0009 — NBA mode

**Date:** 2026-09-10 · **Decided by:** Frank

A second sport inside the same app, chosen with a slider on the home screen (NFL | NBA). Same game: season → player → category, three cards, 6 seconds, one streak.

**Choices (Frank, 2026-09-10):**

- **Pool:** per season since 1995, the **top 40 by points per game plus the top 5 by rebounds and top 5 by assists** who are not already in, from ESPN's league leaders (ESPN's own games-played qualifiers apply). Not All-Star based. Extras can be added by hand later, as for the NFL.
- **Season label:** the year the season **ends** (2016 = 2015–16).
- **Categories:** Alma Mater, Draft Team, Jersey Number, **Country** (flag tile) — Country replaces Position.
- **Leaderboard:** one sign-in, **a separate daily board per sport**.

**Data.** `scripts/pull-nba.ts` → `content/nba_selections.csv` + `content/nba_players.csv` (Pro Bowl columns plus `country`, `country_name`, `country_source`). Draft teams: `content/nba_draft_teams.csv`, a hand table of era identities (Sonics, Vancouver, Bullets, original Hornets…) matched by the draft-season team name ESPN returns. Countries: `content/nba_countries.csv` maps ESPN and Wikipedia spellings and demonyms to a flag code; the flag images come from the MIT-licensed flag-icons set (`npm run nba:assets` → `public/flags/{code}.png`). Country order of truth: a curator's manual value, ESPN citizenship, the Wikipedia infobox nationality, then birthplace (ESPN, then Wikipedia) — birthplace-only non-US cases are listed by the pull for review (Kyrie Irving born in Australia, Carlos Boozer in West Germany).

**Jersey numbers.** ESPN's season records carry the current number, not the season's (Kobe shows 24 for 2003–04), so the fallback is the same one-number-career rule as the NFL extras; multi-number players get no Jersey Number round until a season source exists.

**No college.** 60 of 358 players never played college basketball (international, high school). They have no Alma Mater round today; a "NO COLLEGE" tile like UNDRAFTED is an open question for Frank.

**Milestones:** **N1 data** (this) · **N2 engine + config** (mode `nba`, weights, generic pool key) · **N3 screens** (sport slider, flag cards, per-sport board and daily stats, share copy) · **N4 finish** (e2e, legal list: the NBA mark).

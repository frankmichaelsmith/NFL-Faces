# 0006 — Six-second timer, names after every tap, looser crop

**Date:** 2026-09-09 · **Decided by:** Frank, after playing the first deployed build

- The decision timer is **6 s** (was the spec's 5 s). `decisionMs` in `src/game/config.ts`; still flat, never ramps.
- After **every** tap the tapped player's name appears under their card, correct or not. After a miss the correct card's name shows as well (spec §11.3 reveal kept). A timeout shows only the answer.
- ESPN face crops were cutting chins: head factor **1.75** (was 1.5), top margin 0.10. Hand-set Commons crops untouched.

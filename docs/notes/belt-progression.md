# Note: belt progression and rank-ups are deferred

**Decided:** 2026-11-07. Belt progression and rank-ups will be tackled later. The current focus is the minigame framework, so more minigames can be built in parallel.

## What exists today

- Belts are stored per ninja (`ninjas.belt`) and shown on the sash, the HUD belt card and the Quest Log's belt path.
- XP and coins accumulate from minigames (server-granted, with the admin multiplier and per-match cap) and from admin grants.
- The HUD shows XP toward the next belt's threshold (`BELTS` in `shared/protocol.js`) and says "Ready for the … test" once the XP is reached.
- **Only an admin changes a belt** (Players > Belt > Set). Nothing promotes a ninja automatically.

## What is intentionally not built yet

- Automatic promotion when the requirements are met.
- Belt tests: quest lines (Beginner Trials, Shadow Path, Mountain Scroll, Grandmaster), "win 5 minigame matches" for Green, and the Sensei challenge for Brown.
- Dan levels 1–10 after Black Belt.
- Rank-up moments: ceremony, announcement, unlocks.
- The admin **Belt and XP Settings** screen (outline §10.3).

## Things the minigame work should keep in mind

- **Wins are already recorded.** `minigame_scores` stores the place, so the Green Belt rule ("win 5 matches") can be computed later without schema changes (`minigameStats()` already returns wins).
- **XP must stay server-granted.** Keep all XP coming through the engine's `addRewards` so belt checks can hook into one place later.
- **Minigames don't change belts.** They must not read or change a player's belt, beyond drawing the sash from the loadout.
- **XP rates may change.** Belt thresholds will likely be retuned once real XP rates from several minigames are known, so don't hard-code belt math in games.

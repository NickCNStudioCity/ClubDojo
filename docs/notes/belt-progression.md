# Note: belt progression

**Updated:** 2026-11-07. Belt tests, daily challenges and login streaks are now in the game. The rules live in `server/src/progress.js`; `server/src/index.js` calls them and pays the rewards.

## What exists today

- Belts are stored per ninja (`ninjas.belt`) and shown on the sash, the HUD belt card and the Quest Log's belt path.
- XP and coins accumulate from minigames (server-granted, with the admin multiplier and per-match cap), daily challenges, the daily login reward, and admin grants.
- **Belt tests with Sensei Oru.** A ninja needs the next belt's XP (`BELTS` in `shared/protocol.js`) plus that test's goals (`BELT_TESTS` in `progress.js`), then clicks Sensei Oru in the Main Dojo (`belt:test`, must stand within 2 tiles of an `npc` prop). Passing promotes one belt, pays coins and broadcasts a `celebrate` message to everyone.
- Test goals read `db.progressRecord()` (rounds played, different games, first places with a score above zero) and `ninjas.progress` (daily challenges completed, best streak).
- **Daily challenges:** three a day, the same for everyone, picked from the date (a play/win goal, a featured placed minigame, a village task). Progress and the login streak are stored as JSON in `ninjas.progress`.
- Admins can still set any belt (Players > Belt > Set).

## Not built yet

- Quest lines (Beginner Trials, Shadow Path, Mountain Scroll, Grandmaster).
- Dan levels 1–10 after Black Belt.
- Unlocks tied to belts.
- The admin **Belt and XP Settings** screen (outline §10.3); thresholds and test goals are constants for now.

## Things the minigame work should keep in mind

- **XP must stay server-granted.** Keep all XP coming through the engine's `addRewards`; the engine's `onRewarded(accountId, { game, place, score, players })` feeds the daily challenges.
- **Minigames don't change belts.** Only Sensei Oru (or an admin) does.
- **XP rates may change.** Belt thresholds will likely be retuned once real XP rates are known, so don't hard-code belt math in games.

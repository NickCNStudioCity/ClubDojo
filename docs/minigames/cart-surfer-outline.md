# Cart Surfer (Outline)

Goal: a home for Cart Surfer in a new Grotto area. The game lives in a cave, and the cave is the place where you ride the mine carts. This outline covers the cave setting and where the game goes next.

Files today:
- Server rules: `server/src/minigames/games/cart-surfer.js` (169 lines). Rails, rockfalls, coins, distance, stun and the finish line are all simulated here.
- Client: `shared/client/minigames/games/cart-surfer.js` (290 lines, canvas track view, left and right rail switching).
- Room: `server/src/rooms-seed.js`, the `grotto()` room (seed v7). The pavilion is `mg1`, at (18, 5).
- Cave prop: `shared/client/world.js`, `propDrawable().cave`.
- Guide: `docs/minigames/README.md`

## 1. Where it lives (done in this change)
- **Grotto** is a rocky yard south of the Forest Village. It is reached by a path south of the village square (portal at the bottom edge, labelled "Grotto").
- **The cave** is cut into the north rock face of the Grotto. The hollow is the cave floor. The mouth opens onto the yard at (19 to 20, 9).
- **Cart Surfer** moved from the village clearing (`mg4`, removed there) to the cave pavilion. The village keeps its other four pavilions.
- The cave is a background prop (`type: 'cave'`). It draws the rock rim and the dark hollow, and it sits below sprites, so ninjas walking inside show up over it.

## 2. Game rules (unchanged for now)
- 1 to 4 players, one round of 60 seconds, track length 3200.
- Left and right arrows (or A and D, or the on-screen buttons) switch rails. Rocks and coins are generated per round.
- Score: coins plus 1 point per 50 units of distance. Rewards are 2 coins and half a point of XP per score point.
- These values stay in `defaults` so admins can tune them.

## 3. Cave look and feel (milestones)
1. ✅ **Cave room:** Grotto room, cave prop, cave floor, and the pavilion moved in. Done in this change.
2. **Mine track art:** draw the rails as a real mine track with sleepers, and the carts as a placeholder minecart sprite with a ninja in it. Replace the flat rock shapes with boulders.
3. **Lighting:** a dim cave palette, with lanterns or torches that add a glow around each cart. Tie the glow to the existing `time` value so it flickers.
4. **Cave sounds (stretch):** a drip, rumble and crash. Only if the audio layer already exists; otherwise skip.
5. **Entrance feedback:** a sign or banner at the cave mouth that shows the best distance for the day. Uses the existing `topMinigameScores` query.

## 4. Gameplay ideas (after the art)
- **Coin streak:** collect coins without crashing to build a multiplier, which resets on a crash.
- **Pickups:** a lantern that clears the next rock, and a magnet for coins. Both spawn at the same rate as coins.
- **Shorter rounds:** a timed "dash" mode of 30 seconds, next to the full run.
- Keep the server authoritative. Any new pickup goes in `makeTrack` and the server `tick`. The client only draws what the server broadcasts.

## 5. Testing
- `npm run check:minigames` after each server change.
- Start the server, walk into the Grotto from the village, and confirm the pavilion sits inside the cave with its pad at (19, 7).
- Two player clients in the cave: each sees their own cart move and the other carts stay in sync.
- Check the seed upgrade: an existing server should move `mg4` out of the village and add the Grotto on its next start (seed v7). The Map Editor edits on the village are replaced by this seed, so check them first.

## Open points
- Whether the cave should be a separate room or a part of the Grotto. The outline assumes one room with the cave built into it.
- Whether the village should keep a Cart Surfer pavilion as a shortcut, or whether the cave should be the only spot.
- Whether the cave mouth should be a portal into a second room. Only if the cave outgrows one room.

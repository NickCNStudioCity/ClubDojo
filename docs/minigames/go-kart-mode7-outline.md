# Go-Kart Race: Mode 7 Version (Outline)

Goal: turn the existing `go-kart-race` minigame into a 2.5D Mode 7 racer in the style of the original Mario Kart. Other players' ninjas are drawn on the track as sprites. Placeholder art until real sprites exist.

Files today:
- Server rules: `server/src/minigames/games/go-kart-race.js` (247 lines, server simulates every kart, track is a generated loop of 36 samples)
- Client: `shared/client/minigames/games/go-kart-race.js` (259 lines, canvas top-down drawing)
- Guide: `docs/minigames/README.md`

Decision: keep the server authoritative and replace only the client renderer with a Mode 7 projection. The server's simulation stays the source of truth for positions, laps and scores.

## 1. Architecture
- **Server (rules):** keep the existing kart simulation, lap and position logic. Move the track definition (centerline, width, checkpoints, start grid) into a shared module so server and client use identical geometry.
- **Client (render):** a Mode 7 renderer on a `<canvas>`. Draws the track ground, sky, then sprites sorted by distance.
- **Protocol:** unchanged in principle. Clients send steering and pedal state; the server sends kart positions, headings, speeds and lap counts each snapshot. Snapshot rate should be reviewed for smooth interpolation on the client.

## 2. Track data
- A top-down track image (ground, road, grass, wall) plus a collision mask derived from it or from the centerline and width.
- Source of truth for collision: the shared track module. The image is for rendering only, so the two must agree (generate or check the image from the same data).
- Waypoints in order, checkpoint lines, start grid slots.
- Placeholder: one generated track (the current loop) rendered into an image at build time or at load.

## 3. Mode 7 renderer
- Inputs: camera position (behind the player kart), heading, height, horizon line, field of view.
- For each screen row below the horizon, compute the world-space line it sees and sample the track image along it. Nearer rows sample a smaller area, which gives the perspective.
- Speed-up for rendering: precompute a per-row lookup, or render at half resolution and scale up.
- Sky: a parallax background strip that scrolls with heading.
- Keep the Mode 7 math in its own file (for example `shared/client/minigames/games/go-kart-mode7/mode7.js`) so it can be tested in isolation.

## 4. Sprites
- **Karts (other ninjas):** placeholder billboard sprites, one per player colour, with a name tag. Scale by distance, draw back-to-front.
- **Directional frames:** start with 8 placeholder angles, or a single sprite that flips for left and right. Real art can replace these later without code changes.
- **Props:** placeholder markers for checkpoints, start line and kerbs.
- Use the existing `avatar` helper where it fits, so player appearance carries over.

## 5. Camera and HUD
- Third-person chase camera behind the local player's kart, with smooth follow.
- HUD: position (1st to 4th), lap counter, speed. Keep the existing `gk-hud` and `gk-status` elements where possible.
- Countdown and results stay in the shared host, as today.

## 6. Milestones
1. ✅ **Shared track module:** move the track into a shared file, keep server behaviour identical, run `npm run check:minigames`. Done: `go-kart-mode7/track.js`. A fixed-input run gives byte-identical broadcasts.
2. ✅ **Mode 7 floor:** render the track ground for the local player only, with no other karts. Verify in the browser at a phone width and a desktop width. Done: `go-kart-mode7/mode7.js` and a 400×240 pixelated view with a minimap (other karts show as dots there). Tests: `npm run check:mode7`. Dev harness: `scripts/dev/go-kart-harness.html` (server rules in the browser, plus bots).
3. ✅ **Sprites:** draw remote karts as placeholder billboards with depth sort and names. Done: `go-kart-mode7/sprites.js` draws an 8-angle placeholder sheet per kart (player colour, headband from the loadout). Every kart, yours included, is drawn back to front. Name tags are a DOM layer, so they stay sharp, and fade out with distance.
4. ✅ **Snapshot smoothing:** interpolate remote kart positions between server snapshots. Done: fixed 60 Hz physics, 20 Hz snapshots, client renders 100 ms behind.
5. ✅ **Polish:** sky, HUD, chase camera tuning, placeholder track art. Done: `go-kart-mode7/scenery.js` adds a seamless 360° sky panorama (sun, clouds, mountains, hills, tree line) that turns with the camera, a haze band at the horizon, seeded trackside props (trees, pines, bushes, tyre stacks on the outside of bends) and a start gantry, all depth-sorted with the karts. The grass has tufts and flowers. The HUD sits over the view and scales with it: place, lap (gold on the final lap), a timer that turns red in the last 15 s, a speedometer, and a centre banner for GO!, LAP 2, FINAL LAP!, WRONG WAY and FINISH!. The chase camera uses time-based smoothing (the same at any frame rate), pulls back, rises and widens the view with speed, and rumbles off the road. Checks: `npm run check:mode7` covers prop placement and the gantry.
6. **Stretch:** a second track, real sprites, pickups.

## 7. Testing
- `npm run check:minigames` after each server change.
- Unit-test the Mode 7 projection maths (a point at a known world position should land on a known screen pixel).
- Manual check: two player clients in the same pavilion, each seeing the other's kart at the right place and distance.

## Open points
- Snapshot rate: the current server tick may be too slow for smooth Mode 7 motion. Decide after milestone 2.
- Whether the existing 4-player limit stays (the outline assumes it does).
- Whether the top-down view is kept as a toggle for debugging.
- Wall contact (server): a kart pressed into the wall with the gas held is pinned at about 5 speed, and turns very slowly because steering grip scales with speed. Seen while testing milestone 5. Not changed yet, since it is server physics.

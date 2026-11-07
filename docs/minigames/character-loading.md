# Outline: loading the player's character into a minigame

**Status:** outline. Steps 1–3 are built (the loadout snapshot, the shared avatar renderer and the accessory slots). Steps 4–7 describe the plan for when inventory and the shop arrive.

**Goal:** every minigame shows each player's own ninja (gi, headband, belt sash and equipped accessories), consistently and fairly. A game should never need to know how a particular hat is drawn.

## 1. The loadout: a snapshot of how a ninja looks (built)

When a player joins a lobby, the server builds a **loadout** from their saved ninja with `loadoutFromNinja()` in `shared/protocol.js`:

```js
{
  v: 1,                    // schema version; bump when fields change
  id: 12,                  // account id
  name: 'Kai',
  color: '#2f6fd1',        // gi
  headband: '#e8453c',
  belt: 'yellow',          // drives the sash color only
  accessories: {           // slot -> item id (empty today)
    back: 'katana-oak',
    head: 'hood-shadow',
    face: 'mask-fox',
    hand: 'fan-paper',
    body: 'robe-crane',
    feet: 'tabi-red',
  },
}
```

- **Built on the server**, from the database, so clients can't dress up as items they don't own.
- **Frozen for the match.** Changing your look mid-round doesn't affect a game in progress. The lobby picks up the new look the next time you join.
- **Sent everywhere it's needed.** It's in every `mg:lobby` player entry, and the server module gets it as `ctx.players[i].loadout`.
- **Stored in one place.** It lives in the `ninjas.accessories` column (JSON, added in v1.1, default `{}`).

## 2. The avatar renderer: one way to draw a ninja (built)

`shared/client/avatar.js` (`window.ClubDojoAvatar`) is used by the world, menus, lobby cards, results and every minigame:

- `draw(ctx2d, loadout, { x, y, size, facing, walking, time, you })` draws at any scale and returns the geometry `{ cx, top, feet, bw, bh, T }`, so games can attach effects (a thrown shuriken starts at the hand, a fishing line at the rod tip).
- `portrait(loadout, px)` returns a small canvas for cards and scoreboards.
- `preload(loadouts)` waits for any image assets before the round starts. The host calls it before `mount()`.

## 3. Accessory slots and layering (built)

Slots are defined in `ACCESSORY_SLOTS` (shared protocol): `back, body, head, face, hand, feet`.

| Layer order | Drawn |
|---|---|
| 1 | Shadow and "you" ring |
| 2 | `back` (sword, quiver), behind the body |
| 3 | Base ninja: gi, face, headband, belt sash |
| 4 | `body` (robe or vest), then `feet`, then `face` (mask), then `head` (hood or hat), then `hand` (fan, staff) |

An accessory is registered once with `ClubDojoAvatar.registerAccessory({ id, slot, name, draw(ctx, g, loadout), preload? })`. Its `draw` uses the geometry `g`, so it scales with the ninja. Unknown item ids are skipped silently, so an older client never crashes when it sees an item it doesn't have yet. Each accessory is drawn inside `save()`/`restore()` and wrapped in a try/catch.

## 4. Where accessories come from (planned: inventory and shop phase)

1. **Items table:** add `slot` and `asset` columns to `items` (outline §11), plus an `accessory: true` type.
2. **Equipping:** the Ninja panel gets slots. Picking an owned item sends `equip { slot, itemId }`. The server checks ownership in `inventory` and the slot match, then writes `ninjas.accessories`.
3. **Shown in the world too:** `publicPlayer()` adds `accessories`, so the room sees the same look as the minigame. `player:look` already broadcasts changes.
4. **Item definitions ship with the client:** they live in `shared/client/accessories/<id>.js`, loaded on demand like minigame modules, with a manifest so `preload` knows which files to fetch.

## 5. Per-minigame presentation (planned)

Games can adapt a loadout without changing what the player owns:

- **Overrides:** `draw(ctx, loadout, { ..., override: { hand: 'rod-ice' } })` swaps a slot for the round. For example, Ice Fishing hands everyone a rod, and Shuriken Arena hides `hand` to show the throwing pose.
- **Hidden slots:** `hide: ['back']` hides a slot for small sprites or games where it would block the view.
- **Poses:** `pose: 'stand' | 'run' | 'jump' | 'throw' | 'sit'`. Accessories get the pose in `g` so they can follow it. Rooftop Race needs `run` and `jump` first.
- **Size tiers:** at sizes under about 24 px, skip fine details (face accessories) for clarity. Pass `detail: 'low'`.

## 6. Fairness rules (planned, enforced by review)

- Accessories are **cosmetic only**. Minigame server modules must not read `loadout.accessories` to change scoring, speed or hitboxes.
- Hitboxes use the base ninja size, never accessory bounds.
- Sound and visual effects tied to items are allowed, as long as they don't hide information other players need.

## 7. Loading sequence (built, with planned steps marked)

```
player clicks pavilion → walks to pad → mg:join
  server: loadoutFromNinja(ninja)  ──▶ lobby.players[i].loadout
  client host: show lobby (portraits from loadouts), load games/<id>.js
countdown ends
  server: game.create(ctx with players + loadouts)
  client host: await ClubDojoAvatar.preload(loadouts)   ← image accessories (planned)
               mount(ctx)  → game draws ninjas with ctx.avatar.draw(...)
results → host shows portraits again → back to lobby (loadouts refresh on next join)
```

## Open questions

- Should the lobby refresh loadouts live if someone changes their look while waiting? Probably yes, since it's cheap: re-snapshot on `setLook`/`equip` while the lobby phase is `lobby`.
- Should accessories be vector code, or PNG sprite sheets? Vector code fits the current art and needs no asset pipeline; sprites suit pixel art. The renderer supports both through `draw` and `preload`.
- Should Dan levels (after Black Belt) show on the sash as stripes? That's tied to the belt work in [../notes/belt-progression.md](../notes/belt-progression.md).

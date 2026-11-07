# ClubDojo: Project Outline

A locally hosted, Club Penguin-style world where you play as a ninja. You train at the dojo, earn your belt by completing quests and objectives, and play minigames with other ninjas. One host computer runs the world server. Any number of laptops on the same local network run the player client. A separate admin client has all the player features plus extra tools for running the world.

## 1. Goals

- Run entirely on a local network (LAN). No internet or cloud account required.
- Multiple ninjas on multiple laptops, sharing one persistent world.
- Local accounts with a username and password, stored on the host.
- Ninja progression: earn belts by completing quests and objectives.
- Customization: ninja look, dojo decoration, inventory.
- Minigames that reward XP, coins, and items.
- Admin client with extra tools to edit the map, build quests, manage players, and moderate.

## 2. Architecture

```
            +---------------------------+
            |        HOST PC            |
            |  World Server (Node.js)   |
            |  - WebSocket realtime     |
            |  - SQLite database        |
            |  - Map, quest, asset data |
            +-------------+-------------+
                          | LAN (WebSocket, port e.g. 7777)
     +--------------------+--------------------+
     |                    |                    |
+----+-----+        +-----+----+        +------+---+
| Player   |        | Player   |        | Admin    |
| Client   |        | Client   |        | Client   |
| (laptop) |        | (laptop) |        | (host or |
+----------+        +----------+        |  laptop) |
                                        +----------+
```

- **World Server** is the single source of truth. Clients send intents ("move to x,y", "accept quest", "throw shuriken"). The server validates them and broadcasts the result.
- **Player Client** is a single desktop game window. Everything the player sees and clicks lives inside that window: the world, HUD, chat, menus, quest log, shop, and minigame lobbies. It does not open separate panels or windows.
- **Admin Client** is a separate desktop app with an admin login. It includes every player feature and adds the world-building and management tools in section 8. Admin tools never appear in the player client.
- **Database** is SQLite (one file on the host). Back it up by copying one file.

### Suggested stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | Electron | Mature, easy to ship to Windows and Mac laptops |
| Game rendering | HTML5 Canvas, with DOM overlays for menus | Fast to build, handles sprites and UI well |
| Realtime | WebSocket (ws or Socket.IO) | Low latency, works on a LAN |
| Database | SQLite (better-sqlite3) | Single file, no install |
| Passwords | bcrypt hashing | Never store plain text |
| Discovery | Host shows its IP and a 6-character join code | No internet needed |

## 3. Networking and Setup

1. Host runs **ClubDojo Server** once. It prints the LAN address (for example `192.168.1.20:7777`) and a join code.
2. Each laptop runs **ClubDojo** (player), enters the address, and logs in or creates a ninja.
3. Optional: UDP broadcast lets clients find the host automatically on the same network.
4. The server allows a set number of connections (default 30). Extra joins see a "dojo is full" message.

Ports and firewall: the host must allow inbound TCP on the chosen port. The setup screen shows a checklist for this.

## 4. Accounts and Ninjas

- Create account: username, password, ninja name, and starting look (checked for duplicates and bad words).
- Login: username and password. Sessions expire when the client closes or after a set idle time.
- Roles: **Ninja** (player), **Sensei** (moderator: mute, kick, reset quests), **Grandmaster** (admin: full control).
- Each account stores: belt rank, XP, coins, quest progress, inventory, ninja appearance, dojo layout, friends list, and minigame stats.

## 5. The World

- **Village rooms** are the core unit: the Snow Plaza (hub), the Ice Hill, the Ramen House, the Main Dojo, the Training Yard, the Shuriken Arena, and so on.
- Each room is a tile grid (for example 40 x 24 tiles) with:
  - Walkable and blocked tiles
  - Portals to other rooms
  - Props (training dummies, banners, lanterns, signs)
  - Spawn points, quest NPCs, and minigame entrances
- Rooms are defined in JSON and edited in the admin client.
- Up to 30 ninjas per room. Chat is per room, plus a global announcement channel.

## 6. Ninja Progression: Belts, Quests, and Objectives

### Belt ranks

| Rank | Unlocked by |
|---|---|
| White Belt | Account creation |
| Yellow Belt | Finish the Beginner Trials quest line |
| Orange Belt | Finish the Shadow Path quest line |
| Green Belt | Win 5 minigame matches |
| Blue Belt | Finish the Mountain Scroll quest line |
| Brown Belt | Reach 500 XP and pass a Sensei challenge |
| Black Belt | Finish the Grandmaster quest line |
| Dan levels (1-10) | Repeatable challenges after Black Belt |

Each belt shows on the ninja's sash in the game. Ranks are checked by the server, so they cannot be faked.

### Quests and objectives

- A **quest** is a short story with a chain of **objectives**. Example: "Collect 10 shuriken, deliver them to Sensei Oru, then win one Shuriken Arena match."
- Objective types: **collect** items, **talk** to an NPC, **reach** a room, **win** or **score** in a minigame, **craft** or **buy** an item, and **train** (complete a practice drill).
- Quests are shown in a **Quest Log** inside the game window. The active quest also appears as a tracker in the HUD.
- Completing a quest gives XP, coins, and sometimes an item. Some quests unlock a belt.
- Daily and weekly quests keep players coming back. These are set by the admin.

### XP and levels

- XP comes from quests, minigames, and daily training drills.
- XP fills the belt progress bar in the HUD. Belt tests (see table) need both the XP and the quest or challenge.

## 7. Customization

- **Ninja look**: outfit (gi, hood, mask, robe), headband color, weapon on the back, and belt sash. Looks come from the shop, quests, and minigames.
- **Dojo decoration** (player-owned room): place banners, scrolls, lanterns, and training gear from inventory.
- **Shop** (Ramen House and Market): buy items with coins. Limited-time items are supported.
- **Emotes**: quick actions like bow, flip, meditate, and throw. Shown above the ninja.

## 8. Minigames

Each minigame runs inside a room, and the game window shows its lobby, scoreboard, and results. Minigames award XP and coins.

| Minigame | Ninjas | Concept |
|---|---|---|
| Shuriken Arena | 2 to 8 | Throw shuriken at moving targets. Highest score wins. |
| Snowfall Dodge | 1 to 8 | Dodge falling snowballs and falling icicles. Longest survival wins. |
| Rooftop Race | 1 to 6 | Race across rooftops and jump gaps without falling. |
| Dojo Memory | 1 to 4 | Repeat the sequence of glowing scrolls. |
| Ice Fishing | 1 | Time the catch to land rare fish for coins. |

Shared rules:
- A minigame has a lobby, a countdown, a round, and a results screen.
- The server runs the game logic, so no client can cheat a score.
- Scores, XP, and coin rewards are saved to the ninja's account.
- Each minigame can be enabled, disabled, or tuned by an admin.

## 9. Player Client (game window only)

The player client is one window. The game world fills it, and all UI is layered on top of the world.

**Always visible (HUD):**
- Top left: ninja name, belt sash, belt progress bar, and XP.
- Top center: current room name and online count.
- Top right: coin count and a mini map toggle.
- Bottom left: room chat, collapsible, with a chat box.
- Bottom right: menu buttons (Quests, Ninja, Inventory, Shop, Friends, Minigames).
- Left side: active quest tracker (one line, click to open the Quest Log).

**Opened on top of the world (modal panels inside the window):**
- Quest Log, Ninja Customization, Inventory, Shop, Friends, Minigame Lobby, and Results.
- Each one opens within the game window and closes with Esc or the X button.

**Not included in the player client:** map editing, player management, server controls, logs, or any admin tool.

## 10. Admin Client

The admin client is a separate app. It has all the player features (play, quests, customization) and the extra tools below. Admin tools need the Grandmaster role, and every change is written to the admin log.

1. **Map Editor**
   - Pick a room, then paint tiles (walkable, blocked, water, rooftop, ice).
   - Place props and quest NPCs, set portal targets, and set spawn and minigame entrances.
   - Live preview. Changes can be **published** to all players or **saved as draft**.
   - Undo and redo, plus room templates.
2. **Quest Builder**
   - Create quests with a chain of objectives, rewards, and belt requirements.
   - Set daily and weekly quests, start and end dates.
   - Test a quest on a practice account before publishing.
3. **Belt and XP Settings**
   - Edit the XP needed per belt and the requirements for each belt test.
   - Set XP rates for quests, minigames, and training drills.
4. **Players**
   - Search and filter by name, belt, role, or online status.
   - View a ninja: belt, XP, quest progress, coins, inventory, and history.
   - Actions: give or remove coins, items, XP, or a belt. Reset quest progress. Mute, kick, ban, reset password, change role.
5. **Live World**
   - See each room and who is in it.
   - Broadcast an announcement, or teleport a ninja to a room.
   - Start a special event (double XP, a bonus minigame).
6. **Minigames**
   - Enable, disable, and set reward multipliers.
   - View and reset leaderboards.
7. **Shop**
   - Add, price, and schedule items. Set limited stock.
8. **Logs**
   - Login history, chat log (for moderation), quest completions, and admin action log.
9. **Server**
   - Connection count, port, max players, backup now, export data, and restore from backup.

## 11. Data Model (summary)

| Table | Key fields |
|---|---|
| accounts | id, username, password_hash, role, created_at |
| ninjas | account_id, name, belt, xp, coins, outfit_id, headband_id, weapon_id |
| inventory | account_id, item_id, quantity |
| items | id, name, type, price, rarity, available_from/until, stock |
| quests | id, name, story, objectives (JSON), rewards (JSON), belt_required, starts_at, ends_at |
| quest_progress | account_id, quest_id, objective_index, progress, completed_at |
| belts | rank, xp_required, test_quest_id |
| rooms | id, name, width, height, tiles (JSON), props (JSON), published_version |
| room_versions | room_id, version, data, created_by, created_at |
| minigame_scores | account_id, game_id, score, played_at |
| chat_log | id, room_id, account_id, message, created_at |
| admin_log | id, admin_id, action, target, details, created_at |

## 12. Security and Safety

- Passwords are hashed with bcrypt. Login is rate-limited.
- The server validates every action (movement, quest progress, purchases, scores, belt promotions).
- Quest rewards and belt promotions are granted only by the server.
- Chat filter for bad words, plus a report button.
- Admin tools are available only to Grandmaster accounts and are logged.
- The database and backups stay on the host. Nothing is sent to the internet.

## 13. Milestones

| Phase | Deliverable | Rough size |
|---|---|---|
| 0. Foundations | Repo, server skeleton, Electron shell, SQLite schema | 1 week |
| 1. Accounts and LAN | Create ninja, login, connect two laptops | 1 week |
| 2. World and movement | Village rooms, tile map, walking, portals, per-room sync | 2 weeks |
| 3. Chat and presence | Room chat, announcements, player list | 1 week |
| 4. Progression | Belts, XP, quest system with objectives, quest log | 3 weeks |
| 5. Customization and shop | Ninja look, inventory, shop, coins, dojo decoration | 2 weeks |
| 6. Minigames | Framework plus Shuriken Arena and Snowfall Dodge, then the rest | 3 weeks |
| 7. Admin client | Map editor, quest builder, belt settings, player manager, live world, logs | 3 weeks |
| 8. Polish | Setup wizard, backups, moderation, packaging installers | 2 weeks |

## 14. Open Questions

1. Art style: original pixel art, or simple vector shapes for the first version?
2. Should the village be snowy mountains (as drafted) or a different setting?
3. Are belt tests timed or open-ended, and should Sensei challenges be live with a Sensei online?
4. How many laptops will connect at once? (30 is comfortable for this stack.)
5. Target OS for the laptops: Windows only, or Windows and Mac?
6. Should players be kids, adults, or a mix? (Affects chat filtering and moderation defaults.)
7. Is the admin client for the host only, or for any laptop with the Grandmaster login?

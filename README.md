# ClubDojo v1

A LAN-hosted ninja village (see [PROJECT_OUTLINE.md](PROJECT_OUTLINE.md)). This first version has three parts:

| Part | Folder | What it does |
|---|---|---|
| World Server | `server/` | Node.js + WebSocket (port 7777) + SQLite. The single source of truth: validates every move, chat line and admin action. |
| Player client | `player-client/` | Electron game window: connect, create a ninja or log in, walk the village, chat, emotes, customize your gi and headband. |
| Admin client | `admin-client/` | The same game plus Grandmaster tools: Live World, Players, Map Editor, Logs, Server. |

Shared code lives in `shared/`: `protocol.js` (constants, belts, tiles, pathfinding) and `client/` (network, canvas world, HUD) used by both apps.

## Release files (Windows)

`npm run release` builds three standalone files into `dist/`. No Node.js or install is needed to run them:

| File | Run it on | Notes |
|---|---|---|
| `ClubDojo-Server-1.0.0.exe` | The host PC | Opens a console showing the address, join code and (first run) the admin login. Data is kept in a `ClubDojo-Data` folder next to the exe, so put the exe in a folder you will keep. |
| `ClubDojo-Player-1.0.0.exe` | Each laptop | Portable: double-click to play. |
| `ClubDojo-Admin-1.0.0.exe` | Host or any laptop | Portable: log in with a Grandmaster account. |

The files are not code-signed, so Windows SmartScreen may show "Windows protected your PC": choose **More info > Run anyway**. Windows Firewall will ask to allow the server on first run; allow it on private networks.

### Updates

The packaged apps update themselves from the latest GitHub release (`NickCNStudioCity/ClubDojo`):

- **Player and Admin** check at launch and every hour. A newer file is downloaded and installed, then the app restarts. The Player's game session is disconnected when that happens. Press **Alt** to show the menu bar, then **Updates > Check for updates** or **Updates > Reinstall latest version**.
- **Server** checks at start and every hour. A new build is installed at start, or once nobody is online. Start it with `--reinstall` to download the latest release again, or with `--no-update` to turn checks off (or set `CLUBDOJO_NO_UPDATE=1`).

A build is detected by its file checksum, not its version number. So if you re-upload a file to the same release, the apps still pick it up. To publish: make a GitHub release marked **Latest**, and attach the three `.exe` files named `ClubDojo-Server-*`, `ClubDojo-Player-*` and `ClubDojo-Admin-*`. Updates only work for the packaged `.exe` files, not for `npm run` from source.

## Requirements (running from source)

- Node.js 22.5 or newer on the host (uses the built-in `node:sqlite`; tested on Node 24).
- Laptops need the same Node install only to run from source. Packaged installers come in the polish phase.

## Run it

```bash
npm install
```

On the host PC:

```bash
npm run server
```

The server prints the LAN address (for example `192.168.1.20:7777`) and a 6-character **join code**. On first run it also creates a Grandmaster login and prints it (it is saved to `server/data/FIRST_RUN_ADMIN.txt`; reset the password from the admin client, then delete the file).

On each laptop:

```bash
npm run player
```

For the admin (on the host or any laptop):

```bash
npm run admin
```

Enter the address and join code, or pick the server from **Found on your network** (UDP auto-discovery on port 7778). Allow inbound TCP 7777 through the host firewall.

### Server options (environment variables)

| Variable | Default |
|---|---|
| `CLUBDOJO_PORT` | `7777` |
| `CLUBDOJO_MAX_PLAYERS` | `30` |
| `CLUBDOJO_NAME` | `<hostname> Dojo` |
| `CLUBDOJO_DATA` | `server/data` |
| `CLUBDOJO_JOIN_CODE` | random, then saved |
| `CLUBDOJO_ADMIN_PASSWORD` | random (first run only) |
| `CLUBDOJO_DISCOVERY` | `1` (set `0` to turn off the UDP beacon) |

Promote an account from the host console: `npm run set-role -w server -- <username> grandmaster`.

Back up by copying `server/data/clubdojo.sqlite`, or use **Server > Back up now** in the admin client.

## What is in v1

- Accounts with bcrypt-hashed passwords, rate-limited login, name and chat filter, roles (ninja, sensei, grandmaster).
- Three rooms: Snow Plaza, Main Dojo and Ramen House, with doors between them. Click to walk; the server checks every path.
- Room chat with speech bubbles, global announcements, emotes (keys 1-6), presence and online count, mini map.
- HUD from the design mockup: belt card and XP bar, room tag, coins, quest tracker, chat, and the menu. Quest Log shows the belt path; Ninja lets you change gi and headband; Inventory, Shop, Friends and Minigames are placeholders for later phases.
- Admin: live room view with teleport, kick and broadcast; player search with coins, XP, belt, role, mute, ban and password reset; tile Map Editor with undo, drafts and publish (players in the room get the update live); chat, login and admin-action logs; server info, new join code, and backup.
- Position, look and progress are saved per ninja.

## In progress (after v1.0.0)

- **Minigame framework.** A server engine runs every lobby (lobby, countdown, play, results), grants rewards and saves scores. A shared client host shows it all inside the game window. Each game is one server file plus one client file. **Dojo Memory** is the first game and the reference implementation. See [docs/minigames/README.md](docs/minigames/README.md).
- **Minigame pavilions on the map.** Walk up to a pavilion to join its lobby. Admins place, re-assign and remove pavilions with the Map Editor's **Minigame pavilion** brush.
- **Minigame list.** The Minigames menu shows installed and in-development games, where to find them, live lobby counts, and your best score.
- **Admin Minigames tab.** Open or close each game, set reward multipliers, and see live lobbies and top scores.
- **Character loading.** Minigames receive each player's loadout (look and accessory slots) and draw it with the shared avatar renderer. See [docs/minigames/character-loading.md](docs/minigames/character-loading.md).
- **Forest Village hub.** The hub is now a forest with grass, dirt paths, flowers and a pond, replacing the Snow Plaza. Existing servers upgrade the hub automatically on start, and the old layout stays in the room history.
- **Deferred.** Belt progression and rank-ups. See [docs/notes/belt-progression.md](docs/notes/belt-progression.md).

This changes the protocol to version 2, so v1.0.0 clients are asked to update.

## Testing

```bash
npm run smoke
```

Starts a throwaway server and connects players and an admin over real WebSockets. It covers:
- accounts: registration, join-code check, kick, persistence
- the world: movement, doors, chat filter, announcements, teleport, map publish
- admin tools: rewards, mute, logs, backup
- minigames: a full two-player Dojo Memory match with rewards, admin open/close, pavilion placement rules
- the v1 → forest hub upgrade

```bash
npm run check:minigames
```

Checks every installed minigame without a server: the client file registers the right id, and matches end on their own with idle or random players (on simulated time).

For quick UI work in a browser, `node scripts/dev-web.js` serves the pages at `http://localhost:5173/player-client/index.html` and `/admin-client/index.html` (no LAN discovery there).

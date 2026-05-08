# Changelog

## 0.1.0 — Beta Launch (2026-05-07)

First public beta of Netrek Web, a browser-based clone of Bronco (Vanilla) Netrek.

### Core Combat

- 10Hz authoritative server with 60fps client interpolation
- Ship movement with 256-direction headings, acceleration/deceleration curves
- Phasers with range-based damage falloff and cooldowns
- Torpedoes with collision detection and splash damage
- Plasma torpedoes with target tracking, splash damage, and phaser counterplay
- Tractor and pressor beams
- Cloaking with fuel drain and server-side position filtering
- Temperature system (weapon/engine heat, burnout, cooling)
- Shield and hull damage, repair mode
- Explosion damage on ship death

### Planet Economy

- 40 planets with team ownership, armies, and feature flags (repair, fuel, agricultural)
- Army population growth on agricultural planets
- Bombing (orbit + drop armies from enemy planets)
- Beaming (pick up / drop off armies, kill-gated carry capacity)
- Planet capture when last army is beamed down by opposing team
- T-Mode activation when enough players are present
- Win conditions: genocide (take all enemy planets) and timercide (surrender timer)
- Surrender timer: 20-minute countdown at 2 or fewer planets, freezes at 3, clears at 4+

### Ships & Roles

- 6 ship types: Scout (SC), Destroyer (DD), Cruiser (CA), Battleship (BB), Assault Ship (AS), Starbase (SB)
- Ship refitting at friendly planets (r key, 5-second freeze)
- Starbase restrictions: Commander rank, 5+ team planets, one per team, 30-minute cooldown
- Starbase docking: repair/fuel bonuses, undock on SB movement or death
- Transwarp to friendly starbase (\* key)

### Ranks & Progression

- 9 ranks from Ensign to Admiral based on DI (Damage Index)
- DI calculated from kills, planets taken, and armies bombed
- Rank displayed in player list and roster
- Rank gates starbase access

### Multiplayer Infrastructure

- Backend API server (NestJS) with PostgreSQL for accounts, stats, match history
- Game server (NestJS) with in-memory state, no database dependency
- ES256 asymmetric game token auth (backend signs, game server verifies)
- Server registry with heartbeat monitoring and auto-offline
- Official vs. community server distinction for stat scoping
- Live stat reporting every 60 seconds
- Match result recording on game end

### Lobby & Server Browser

- Google OAuth authentication
- Server browser with real-time player counts and game phase
- Game detail page with team/ship selection
- Server management page for hosting community servers
- Player stats profile page with rank ladder

### Bot System

- Server-side bots as virtual players (same input interface as humans)
- State machine AI: PATROL, ATTACK, BOMB, ESCORT, DEFEND, OGG, RETREAT
- 3 difficulty levels: Newbie, Competent, Veteran
- Procedural name generation
- Difficulty rebalancing based on player count
- Bot manager with lifecycle hooks and chat integration

### Client

- Canvas 2D rendering with retro pixelated aesthetic
- Tactical view with team-colored ships, weapons, planets
- Galaxy map with strategic overview
- HUD with shields, hull, fuel, speed, armies, weapon/engine temp
- T-Mode and surrender timer indicators
- Game win/loss overlay on genocide or surrender
- Chat system with team/all/self channels
- Macro system with variable expansion (%%T target, %%n armies, etc.)
- Player list panel with team roster, ship types, kills, rank
- Refit overlay with ship selector
- Respawn UI with 3-second countdown and SB restriction display
- Sound effects for weapons, tractor beams, and ship entry
- Full keyboard controls with help overlay (h key)
- Documentation pages for keymap and macro reference

# LAN Texas Hold'em — Design Spec

Date: 2026-07-28  
Status: Approved for planning

## Goal

Run a small-group Texas Hold'em cash game on a local network. One host machine starts the server; friends join from browsers on phones or laptops via a LAN URL. No cloud deployment in v1.

## Requirements

| Item | Decision |
| --- | --- |
| Client | Browser (A) |
| Scope | Single cash table: create room → sit → play → settle (A) |
| Stack preference | Python preferred; TypeScript/JS acceptable |
| Approach | Fork open-source project (chosen: Node/JS) |
| Language UI | Chinese or English both fine |
| Starting stack | 2000 chips |
| Rebuy | Optional; +2000 when broke; spectator until rebuy |
| Rebuy marker | Shame coin (耻辱币) icon per rebuy, shown by name |
| Out of scope | Cloud, accounts, real money, tournaments, persistent leaderboards |

## Chosen base project

**[ptwu/distributed-texasholdem](https://github.com/ptwu/distributed-texasholdem)**

- Node.js + Express + Socket.IO
- Browser multiplayer with rooms
- MIT license
- Local start: `yarn install` then `yarn start` / `yarn dev` (port 3000)

Alternatives considered and rejected for v1:

- `EMMA019/AI_pokergame` — better Python fit, less proven multiplayer
- Greenfield Python engine + web UI — too much work for “play with friends soon”
- `Tehes/poker` — strong local UX, but source-available (not true OSS)
- `theOGognf/private_poker` — TUI/SSH, not browser

## Architecture

```
Friend browsers ──WebSocket──► Express + Socket.IO (host machine)
                                  │
                                  ├─ Static frontend (lobby / table)
                                  ├─ Room management (create, join, start)
                                  └─ Hold'em engine (blinds, betting, side pots, showdown)
```

The host binds to `0.0.0.0:3000` so other devices on the same Wi‑Fi can reach `http://<LAN-IP>:3000`.

## Components

### Upstream layout (kept)

- Server code under `src/` — rooms, players, hand state, Socket.IO events
- Static frontend — lobby + table actions (fold / check / call / raise)
- `package.json` scripts — `yarn dev`, `yarn start`, `yarn test`

### Local adaptations (required)

1. Listen on `0.0.0.0` (not localhost-only)
2. Document LAN usage: find host IP, open firewall if needed, share URL
3. Small UX guards if missing upstream: room-full, missing-room, duplicate nick, minimum two players to start
4. Starting chips **2000** (upstream default is 100)
5. Replace upstream **auto buy-in** with **optional rebuy + shame coins**

### Rebuy & shame coins

Upstream already tracks `buyIns` and can auto-top-up to 100 when a player hits 0. This fork changes that:

| Rule | Behavior |
| --- | --- |
| Starting stack | Each player begins with **2000** |
| Broke | At 0 chips after a hand, player may **Buy 2000** or **Spectate** |
| Spectate | Stay seated/visible, skip dealing and betting; no forced leave |
| Rebuy anytime | Spectator (or broke player between hands) can buy +2000 and resume next eligible hand |
| Shame coin | Each completed rebuy increments shame-coin count (`buyIns`); UI shows coin icons next to the name for everyone |
| Not real money | Play chips only; shame coins are social markers |

Disable `autoBuyIns`. Rebuy is an explicit client action (`rebuy` socket event) validated server-side: player money must be 0 (or spectating broke), then `money += 2000`, `buyIns += 1`, broadcast updated table.

### Play flow

1. Host runs `yarn install && yarn start`
2. Host opens lobby, creates a room, shares room code or URL
3. Friends on same Wi‑Fi open `http://<LAN-IP>:3000`, enter nick, join
4. When seated, start hand; play to showdown or uncontested pot
5. If someone busts: prompt rebuy or spectate; shame coin appears on each rebuy
6. Continue hands until the group stops (no persistence required)

### Data flow

Client action → Socket.IO → server validates and updates game state → broadcast → clients refresh table.

## Error handling

| Case | Behavior |
| --- | --- |
| Unknown room / full room / duplicate nick | Clear client error; no silent failure |
| Action out of turn | Server rejects with error |
| Illegal bet/raise | Reject; surface legal min/max when practical |
| Disconnect mid-hand | Auto-fold for the current hand when practical; document any upstream deviation in README |
| One player left with chips / all others folded | Award pot; start next hand or end table normally |

Host restart clears all rooms/state. That is expected for v1.

## Acceptance criteria

1. After `yarn start` on the host, another device on the same Wi‑Fi can open the lobby
2. At least two players can create/join a room and start a hand
3. One full hand completes: blinds → preflop betting → flop/turn/river as needed → showdown or early pot award
4. Fold / Check / Call / Raise follow basic No-Limit Hold'em rules
5. Bust → optional rebuy 2000 or spectate; rebuy later still allowed; each rebuy shows a shame coin
6. No persistence after host restart (documented)

## Testing

- Manual: two browsers (or host + phone) walk the acceptance path
- Keep upstream unit tests; add tests when changing rule/turn logic

## Non-goals (explicit)

- Cloud hosting, HTTPS reverse proxy, accounts/auth
- Real-money play or chip ledgers across sessions
- Multi-table tournaments, rankings, Chinese localization (optional later)
- Major visual redesign of the upstream UI

## Success definition

Friends on the same LAN can sit at one cash table in a browser and play complete hands without installing anything beyond a modern browser on client devices.

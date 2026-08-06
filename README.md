# All the King's Men

A PlayCanvas toy-theatre siege about one terrible hill. Green spends finite
ammunition to crack Humpty; Red uses braces, raids, a rescue winch, and one
last-chance catch net to carry him through the tenth bell.

The game uses simultaneous orders. Each commander secretly commits one formed
unit, both orders reveal together, and the server resolves cover, fire, damage,
cooldowns, rescue effects, and victory before the next turn.

## Run It

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

```bash
npm run typecheck
npm run lint
npm test
npm run generate:public-replays
npm run build
npm run check
```

No OpenAI key is required. The commanders use deterministic, seeded utility
rules so every battle can be replayed exactly.

## The Field

Red commands Field Engineers, a Rescue Winch, and a Catch-Net Sledge. Green
commands a Battering Ram, Siege Mortar, and Siege Ballista. Equipment has visible
integrity, ammunition, and cooldown state. Orders may address the foundation,
tower face, Humpty, or enemy equipment.

The right ledger provides:

- **Watch:** battle clock, targets, simultaneous orders, equipment, public
  record, and replay transport;
- **Archive:** complete seeded battles and their outcomes;
- **Command:** legal unit, order, and target controls during the planning
  window.

Collapsing the ledger preserves view-specific controls and status. The stage
controls pause, refit the camera, expose physical diagnostics, and restart.

## Architecture

Rapier 3D on the server is the only gameplay physics world. PlayCanvas renders
public snapshots. `server/core/siege-rules.ts` owns the tactical rules;
`server/core/battle-director.ts` owns turn timing; `shared/core-protocol.ts`
defines the public contract.

GitHub Pages serves three packaged battle replays from `public/replays`. It is a
static theatre and cannot host the local Node/WebSocket simulation or accept
live orders.

The earlier loose-part construction kit remains as an isolated engineering
test bed. It is not spawned by the main battle and is not shown in the primary
interface.

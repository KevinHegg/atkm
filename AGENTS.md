# All the King's Men Siege Rules

## Main Game

The primary game is a simultaneous-order siege tactics game. It is not a
machine-construction game. Green has ten one-minute turns to crack Humpty; Red
wins if Humpty retains integrity through the tenth resolution or Green exhausts
its operational siege train.

Each turn has four explicit phases:

1. both commanders secretly choose one legal unit, order, and target;
2. both orders are revealed together;
3. defense, fire, damage, ammunition, cooldowns, and rescue effects resolve;
4. the public battle record captures both orders and the result.

The fixed field force is:

- Red: Field Engineers, Rescue Winch, Catch-Net Sledge;
- Green: Battering Ram, Counterweight Trebuchet, Siege Ballista.

The four public target classes are the tower foundation, exposed tower face,
Humpty, and enemy equipment. The catch net may turn one lethal fall into a
second chance; it cannot be rearmed after that save.

## Source Of Truth

- `server/core/siege-rules.ts`: unit catalog, legal orders, deterministic
  commanders, counterplay, damage, ammunition, and victory rules;
- `server/core/battle-director.ts`: planning/reveal/resolution timing and public
  match state;
- `shared/core-protocol.ts`: snapshots, commands, units, orders, and replays;
- `server/core/physics.ts`: the single Rapier 3D battlefield and physical
  effects;
- `client/main.ts`, `client/style.css`, `client/lab-world.ts`: battle ledger,
  replay transport, command surface, and PlayCanvas presentation;
- `scripts/generate-public-replays.ts`: the three GitHub Pages battles.

## Commands

- Development: `npm run dev`
- Type checking and lint contract: `npm run typecheck`, `npm run lint`
- Tests: `npm test`
- Rebuild public battles: `npm run generate:public-replays`
- Production build: `npm run build`
- Full acceptance: `npm run check`

## Non-Negotiable Rules

- Rapier 3D on the server remains the only gameplay physics world.
- PlayCanvas consumes snapshots and never creates gameplay authority.
- Orders must name an advertised unit, action, and target. Invalid, disabled,
  cooling, or spent equipment cannot act.
- Both valid orders resolve simultaneously. Destroying a unit during an
  exchange does not erase the order it already fired.
- Ammunition, integrity, cooldowns, cover, and the catch-net save are finite and
  visible.
- Seeded commanders must be deterministic. An LLM may later add commander voice
  or select from valid advertised orders, but it may not create rules, private
  actions, hidden forces, or outcomes.
- Physics provides movement, projectiles, collisions, and spectacle; tactical
  state decides the legible battle result.
- GitHub Pages is a static replay theatre. Do not imply that it hosts the local
  Node/WebSocket simulation or accepts live orders.

## Legacy Engineering Lab

The nine-family, 24-piece-per-team kit, four connection classes, fixtures, and
construction actions remain in the repository for isolated engineering tests.
They are not part of the primary match, are not spawned in battle mode, and
must not be restored to the main interface without a separate design decision.

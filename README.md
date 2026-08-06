# All the King's Men

A PlayCanvas toy-theatre siege in which two autonomous crews operate physical
war and rescue machines around Humpty, the Egg King. Green has ten minutes to
crack him; Red wins if the bell rings first.

## Requirements

- Node.js 20 or newer
- An `OPENAI_API_KEY` in `.env` for live model agents

## Commands

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The development server prints the selected model, seed, and build ID.

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
```

`lint` currently runs the strict TypeScript checker because the repository has no separate style linter. `check` runs type checking, tests, and the production client build.

## Agent Configuration

```dotenv
AGENT_DRIVER=llm
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=none
```

When the model is unavailable, the same four advertised tactics use a
deterministic utility fallback. Green wins on a crack or hard floor impact. Red
wins at ten minutes while Humpty still has positive integrity.

## Controls

The top control bar provides pause, fit, tower test, sound, engineering overlay, and restart. Keyboard controls are `Space`, `0`, `M`, and `R`. Audio begins only after the sound control is pressed; local royal voice clips do not require a system speech voice.

The right ledger has three workspaces: Watch for the current match, Archive
for durable public replay records with playback speed and scrubbing, and
Organize for launching a seeded next match. Launching preserves the prior
match in the archive. The sound control primes local Egg King and Mad Queen
clips after the browser gesture, with system-voice fallback for generated
lines.

## Architecture

Rapier on the server is authoritative. PlayCanvas renders and animates
snapshots. The live tactical director is in `server/core/battle-director.ts`;
the battle and replay protocol is in `shared/core-protocol.ts`. The frozen
construction kit and `/contraptions` endpoint remain available to the manual
Gate 1-5 lab. The complete agent-facing contract is available at
`/agent-context`.

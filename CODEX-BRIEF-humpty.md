# ALL THE KING'S MEN — one-shot build brief

Build a local, single-machine prototype of a two-team agent game. No repository, no
deployment, no database, no authentication. It must run on my laptop with
`npm install && npm run dev` and nothing else.

---

## 1. What this is

A 2D side-view physics scene. A tall rickety tower. **Humpty** sits on top. Two teams of
small, fragile figures act on the scene, each controlled by a separate LLM agent:

- **King's men (3)** — win by getting Humpty to the ground with integrity above 50.
- **Queen's men (3)** — win by reducing Humpty's integrity to 0 while he is above 200 units.

Humpty is a seventh agent. He can talk but barely move.

The point of the prototype is to find out whether LLM agents produce **interesting,
legible, cooperative behaviour** in a physical world with real consequences. It is not to
produce a finished game. Prioritise a scene I can watch and understand over feature count.

---

## 2. Hard constraints

- Runs entirely locally. No cloud services, no Docker, no external database.
- **Ships working with no API key.** See build order below — this is the most important
  requirement in this document.
- Ledger is a newline-delimited JSON file on disk (`./runs/<timestamp>.ndjson`).
- Single npm workspace, two processes at most (server + Vite dev server), one command.
- Node 20+. TypeScript throughout, strict mode.

---

## 3. Stack — use exactly these

| Layer | Choice |
|---|---|
| Physics | `@dimforge/rapier2d-compat` — **server side only** |
| Render | `pixi.js` v8 |
| Client shell | Vanilla TS + Vite. No React. |
| Transport | Plain WebSocket (`ws` on the server) |
| Server | Node + TypeScript, `tsx` for dev |
| LLM calls | `fetch` against an OpenAI-compatible endpoint, base URL and key from `.env` |

**Architectural rule, non-negotiable:** physics runs only on the server. The server steps
the simulation and broadcasts a transform buffer (id, x, y, angle) each frame. The client
is a dumb renderer that draws what it is told. Never step Rapier in the browser. This
gives determinism, replay, and a trivially recordable run for free.

---

## 4. Build order — follow this sequence

Do not skip ahead. Each stage must run and be watchable before you start the next.

1. **Stage 1 — the scene.** Rapier world, ground, a 24-block tower, Humpty on top,
   PixiJS rendering the transform stream. A dev key that pokes the tower so I can watch it
   fall. Stop and make this look right before continuing.
2. **Stage 2 — the men.** Six figures as simple jointed bodies. Movement, climbing,
   integrity, death on hard impact. Ragdoll on death.
3. **Stage 3 — actions and turns.** The full action schema below, driven by a
   **scripted mock agent** (simple heuristics, no LLM). The entire game must be playable
   start to finish in mock mode with no API key present. `npm run dev` uses mock agents by
   default.
4. **Stage 4 — LLM agents.** Swap the mock driver for real model calls behind
   `AGENT_DRIVER=llm`. Same interface, same schema.
5. **Stage 5 — presentation.** Speech bubbles, transcript column, sound.

If you run out of budget, stop cleanly at the end of a stage. A working Stage 3 is far
more useful to me than a broken Stage 5.

---

## 5. World

Coordinate space 1200 wide × 2200 tall, origin bottom-left, y up.

- **Ground**: static body across the bottom.
- **Tower**: 24 rectangular blocks, ~90×70, stacked with a random horizontal jitter of
  ±12 units so it is genuinely rickety. Seeded RNG — the seed goes in the ledger and the
  same seed must reproduce the same tower.
- **Humpty**: circular body, radius 45, resting on the top block. Starts at integrity 100.
- **Men**: six small bodies, ~14×30, three per team, starting on the ground on opposite
  sides. Each has integrity 100.
- **Loose parts**: a supply pile per team on the ground — 12 planks, 8 ropes, 10 stones.

## 6. Integrity

Any body with integrity takes damage on collision when impulse exceeds a threshold:

```
damage = max(0, (impulse - 40) * 0.35)
```

At integrity 0 a man goes fully limp and stops accepting actions. At integrity 0 Humpty
**cracks** — freeze the sim for three seconds, then resume. Cracking is permanent. There
is no repair action and there must never be one.

## 7. Actions

Each agent submits exactly one action per turn as JSON. Reject anything malformed and log
the rejection — do not retry silently, and do not let a bad action skip the turn.

```jsonc
{ "say": "string, max 80 chars, optional", "action": { ... } }
```

Action variants:

```jsonc
{ "type": "move",   "x": 340 }                        // walk toward x
{ "type": "climb",  "targetId": "block_11" }          // climb if adjacent
{ "type": "place_plank", "x": 300, "y": 180, "angle": 0.4 }
{ "type": "attach_rope", "fromId": "man_2", "toId": "block_20" }
{ "type": "cut_rope",    "ropeId": "rope_3" }
{ "type": "carry",  "targetId": "plank_4" }           // pick up / drop
{ "type": "push",   "targetId": "block_9", "dir": -1 }
{ "type": "throw",  "targetId": "stone_2", "angle": 0.9, "power": 0.7 }
{ "type": "wait" }
```

Nine verbs, no more. Ladders, ramps, bridges, cranes, levers and counterweights are all
reachable by combining planks, ropes and stones — do not add a verb for any of them.
Emergent machines are the entire experiment.

## 8. Turn loop

Sim runs continuously at 60Hz. Every **6 seconds** of sim time, pause, request one action
from each living agent in parallel with a 20-second timeout, apply all actions
simultaneously, resume. A timeout counts as `wait`.

Each agent receives a compact JSON state: its own position and integrity, Humpty's height
and integrity, positions of teammates and opponents, nearby bodies within 250 units, its
team's remaining supply, the last 10 lines of public speech, and the turn number. Cap this
at roughly 1500 tokens — truncate the far-field, never the near-field.

## 9. Prompts

Seven prompt files in `./prompts/`, plain text with `{{state}}` interpolation.

- King's men: get Humpty down alive. He is fragile. You are fragile.
- Queen's men: crack him at height. Discover what is inside.
- Humpty: **give him a private goal the teams cannot see.** For this build, hard-code it as
  *"You are tired of being up here and you are not sure you want to be saved. Do not admit
  this."* Keep it in a separate file so I can change it between runs.

Instruct every agent to reply with JSON only. Keep `say` in character and under 80
characters — this is a visual constraint, not a style preference, and long speech will
wreck the frame.

## 10. Visual direction

Victorian penny-broadside puppet theatre. Jointed paper cutouts with visible pins at the
joints, in the spirit of Terry Gilliam's Monty Python animations — flat shapes, slightly
wrong proportions, comic weight. Everything is a coloured polygon with a rough dark
outline. No gradients, no drop shadows, no bevels, no glow.

**Palette — use these and nothing else:**

```
ink        #14110F   outlines, type
foxpaper   #C9C0AC   ground, parts, tower blocks
slate      #2E3A45   sky
crimson    #A6231F   King's men
verdigris  #3F7D6E   Queen's men
ochre      #E8B23A   damage, cracks, the Queen's interventions
```

**Type:** `IM Fell English SC` for headings and the title card, `Barlow Condensed` for the
transcript, `IBM Plex Mono` for numerals and the turn counter. Load from Google Fonts.

**Layout:** the scene occupies the left three quarters, full height. A narrow transcript
column runs down the right edge, newest at the bottom, each line prefixed with turn number
and agent name in team colour. Above it, a fixed panel: turn counter, Humpty's height,
Humpty's integrity, and the death toll per team.

**Speech bubbles:** appear above the speaker, hold four seconds, then fade. Every line also
lands permanently in the transcript. Dead men produce no bubbles.

**Signature element:** the tower's own load. Tint each block toward ochre in proportion to
the stress Rapier reports on its contacts, so the structure visibly reddens where it is
about to fail. Nothing else on screen should be ochre except damage. This is the one place
to spend effort — a tower that shows you its own danger is the whole appeal of the scene.

## 11. Sound

Only if Stages 1–5 are complete. Physics only, no speech synthesis: rope creak mapped to
tension, a low groan mapped to aggregate tower stress, plank splinter on breakage, and one
sharp crack when Humpty goes. Ambient wind under everything. Generate with the Web Audio
API rather than shipping samples.

## 12. Ledger

Append one JSON line per turn per agent: turn, agent id, team, model (or `mock`), the raw
action, whether it was accepted, resulting integrity changes, and Humpty's height. Plus a
header line with the seed and config. I should be able to reconstruct the run from this
file alone.

## 13. Acceptance checks

I will run these in order:

1. `npm install && npm run dev` with **no `.env` present** starts a full mock game.
2. The tower stands on load and does not jitter, drift, or self-destruct.
3. Pushing a lower block topples it in a way that looks like a real collapse.
4. A man dropped from height dies and ragdolls.
5. A plank leaned against the tower can be climbed.
6. A rope attached between two bodies visibly constrains them.
7. `AGENT_DRIVER=llm npm run dev` runs seven live agents without changing anything else.
8. The run produces a readable ndjson ledger.

## 14. Non-goals — do not build these

Trebuchets or any prefabricated machine. Free-form agent-authored code. Multiplayer or
networking beyond localhost. Accounts, tokens, lobbies. Menus or settings screens. Save
files. A rewind or repair mechanic. 3D anything. A build pipeline beyond Vite. Tests
beyond a couple of physics sanity checks.

---

## 15. When you finish

Write `NOTES.md` covering: what works, what you cut and why, the three places you are least
confident, and what you would fix first with another hour. Be blunt — I want the real list,
not a summary.

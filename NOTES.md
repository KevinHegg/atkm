# All the King's Men — build notes

## What works

- `npm install && npm run dev` starts one local process and a complete mock game
  without an `.env` file or API key.
- Rapier owns all physics on the server. The Pixi client receives transforms and
  never steps the world.
- The seeded seven-block tower opens perfectly still, carries a visible load map, and
  becomes fully dynamic when a block, stone, plank, or rope disturbs it.
- Six detailed paper soldiers cross a wide, perspective stage with grounded feet,
  team equipment, role labels, marching gait, sustained grapples, and ragdolls
  when a hard fall reduces them to zero integrity.
- Humpty is the visual lead: his eyes track danger, his eyebrows and mouth react,
  his arms gesture while he talks, and his costume, shell texture, sling, and
  hardware remain readable throughout the rescue. Humpty ignores resting load,
  rope tension, ordinary shoves, and weak debris. Only a hard fall or a heavy
  projectile can crack his shell.
- Every action validates through one schema. Bad actions become explicit,
  logged waits instead of disappearing or receiving a hidden retry.
- Six mock agents and Humpty act in parallel ten-second turns. King's agents fight
  through the Queen's line while assembling squared timbers, a ladder, mast,
  brace, pulley, sling, and capstan into one compound lowering machine. A rope
  cannot attach directly to Humpty. The Queen's agents build barricades, grapple
  the riggers, throw volleys, and attempt one heavy siege shot. A verdict arrives
  after roughly 90 seconds.
- Agent speech is a control channel: a command on one turn changes the team's next
  action, while teammates answer with short acknowledgements or questions. Every
  spoken line is capped at ten words at the simulation boundary. Each speaker has
  a distinct release schedule, so work and talk continue independently.
- Agents receive a material inventory with quantities, construction, affordances,
  and constraints. The descriptions state physical facts without prescribing a
  strategy.
- `AGENT_DRIVER=llm npm run dev` swaps in seven parallel OpenAI-compatible calls
  using the same prompts, state envelope, validator, and action resolver.
- Each run writes a header, one record per acting agent per turn, rejection reasons,
  integrity deltas, Humpty height, and a final outcome to `runs/*.ndjson`.
- The full presentation layer is present: responsive 1200-by-760 Pixi theatre,
  perspective floor, detailed 2.5D machines, active work poses, stress tinting,
  speaker-attached floating dialogue, a
  newest-first auto-scrolling record, scoreboard, event-driven footsteps,
  hammering, capstan work, throws, impacts, falls, short team calls, a shell-and-
  yolk impact sequence, draggable pan, wheel zoom, cinematic follow, pause, poke,
  fit, and restart.

## What I cut and why

- There is no replay viewer. The deterministic seed and action ledger contain the
  reconstruction inputs, but a replay UI would be a separate feature and the brief
  explicitly prioritizes the live scene.
- There is no settings or agent-debug screen. Driver configuration stays in the
  environment so the game opens directly on the performance.
- I did not add repair, rewind, saves, or direct player building. Those would blur
  the autonomous-agent experiment.
- Sound begins muted because browsers require a user gesture before playback. Foley
  uses short procedural Web Audio events; team calls use the browser's available
  speech voices. There is no continuous wind or noise bed.

## The three places I am least confident

1. The current ten-seed balance sample produced eight intact King's rescues and
   two Queen projectile victories, all at 90 simulated seconds with casualties
   in every round. That
   is encouraging, but still a small sample rather than a balance study.
2. I could not exercise a live LLM run without a key. The OpenAI path is typed and
   wired, but some nominally compatible endpoints may not support
   `response_format: {"type":"json_object"}`.
3. Speech synthesis voices vary by browser and operating system. The foley timing
   is deterministic, but the exact character of shouted calls is not.

## What I would fix first with another hour

I would run 100 mock seeds and chart how the Queen wins: direct projectile, rescue
interruption, or hard fall after the last rescuer dies. The next balance target
would be checking whether the current 80/20 split holds across a larger sample.

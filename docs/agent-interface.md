# Agent Interface

## Cadence

Physics advances at 60 Hz. Team planning is bounded and asynchronous; local deterministic initiative keeps workers moving between model responses. Busy workers continue their physical task and may speak. The model never receives engine handles or transform-editing authority.

With `AGENT_DRIVER=llm`, the server sends bounded asynchronous choice batches
to the Responses API. Each batch contains only the current objective, trigger,
observed facts, attempted plan IDs, and advertised rule or plan IDs. The model
returns one listed ID per figure or team. The server validates every ID before
the public action packet reaches Rapier. A timeout, service error, omitted
choice, duplicate choice, or invented ID yields to the seeded director without
stalling the physics loop. `AGENT_DRIVER=mock` uses that fallback directly;
`AGENT_DRIVER=off` leaves the command desk in manual control.

After the one-second bell, all six figures independently choose opening jobs.
Each figure has its own action lane over the same Rapier world. Red and Green
then receive one team lane apiece, so both teams operate compound machines at
the same time while sharing and contesting the same physical stage. A manual
order cancels every individual and team lane first.

## Enumerable Objectives And Rules

`shared/agent-rules.ts` is the public strategy contract. It currently contains
two objectives and 31 rules. Every rule has a stable ID, eligible teams,
objective IDs, phases, base weight, human-readable preconditions, and a packet
made only from public legal actions. Connection rules name one of the four
frozen connection classes. Compound rules also enumerate their simple-machine
ingredients and capabilities. The five ingredients are lever, wheel-and-axle,
pulley, inclined plane, and wedge. The six capabilities are climb, launch,
strike, dislodge timber, lift, and lower. `GET /rules` returns the same catalog
as JSON.

- Red/King: bring Humpty safely to the stage floor.
- Green/Queen: crack Humpty before he stands on the stage floor.

The match snapshot exposes the current rule and applicable IDs for each figure,
the two machine-plan states, measured machine evidence, and concurrent
busy-worker and total-move counts. A rule can enter a
figure's choice set only when its observed facts are true; listing a connection
or operation rule does not grant a recipe, create a joint, move a body, or
bypass action validation.

## Neutral Observation

The compact team state contains:

- stage axes, bounds, landmarks, time, and public objective;
- measured Humpty pose, integrity, and status;
- crew/opponent pose, activity, and current physical task;
- persistent stock ID, kind, mass, lifecycle, free port kinds, and intrinsic capabilities;
- assembly part count, free ports, stability, support margin, failure margin, warnings, and derived capabilities;
- for each derived capability: confidence, input port, output port, ratio, and failure margin;
- legal compatible join options with predicted mechanical result and travel cost;
- reachable use, sabotage, and repair options;
- public speech.

It contains no blueprint, machine name, recipe, preferred action, strategy text, or hidden winner shortcut. Option order is an implementation detail and must not be treated as advice.

## Action Boundary

Agents choose high-level legal actions. The game owns navigation,
collision-aware climbing and carrying, approach, alignment, joint creation,
load test, operation, interruption, and recovery. `climb` is public but accepts
only a live plank or beam with a measured rise. `push` is also the projectile
operation: it applies worker force to a persistent body and succeeds from
measured travel or load displacement. There is no attack, damage, or spawn
shortcut. `LEGAL_ACTIONS` in `shared/core-protocol.ts` is the complete runtime
vocabulary.

`connect` is a persistent job with visible reserve, fetch, carry, stage, align, and lock phases. `sabotage` requires a real connection, compatible method, reach, contest phase, time, and exposure. `repair` targets the same failed connection record. `recover` walks the same persistent body back to stock.

Every choice announces its rule or plan ID and whether the model or seeded
fallback selected it. The Egg King and Mad Queen have speech events that the
client voices after the user enables audio. Worker orders remain in the public
record.

## Reassessment

Machine completion is evidence-based. An incomplete plan records its measured
contacts and travel, releases only action reservations, rescans the changed
world, excludes the attempted plan, and makes one recovery choice. Existing
joints, displaced timbers, dropped parts, and damage remain physical facts for
the new plan. Recovery uses the same model validation and seeded fallback as
the opening decision.

## Objective Judgment

The server judges objective facts from authoritative physics. Red wins only
after intact Humpty remains in stage-floor contact below the safe-speed limit
for one second. Green wins when integrity reaches zero first; a stage-floor
impact at or above 3.0 m/s applies the current terminal crack. The ten-minute
bell remains a draw when neither objective is established.

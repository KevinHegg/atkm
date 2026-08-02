# Agent Interface

## Cadence

Physics advances at 60 Hz. Team planning is bounded and asynchronous; local deterministic initiative keeps workers moving between model responses. Busy workers continue their physical task and may speak. The model never receives engine handles or transform-editing authority.

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

Agents choose high-level legal actions. The game owns navigation, collision-aware carrying, approach, alignment, joint creation, load test, operation, interruption, and recovery. The active model-facing subset is `connect`, `test`, `use_assembly`, `detach`, `sabotage`, `repair`, `recover`, movement, physical combat, and wait. `data/actions.json` defines the complete vocabulary and physical semantics for staged expansion.

`connect` is a persistent job with visible reserve, fetch, carry, stage, align, and lock phases. `sabotage` requires a real connection, compatible method, reach, contest phase, time, and exposure. `repair` targets the same failed connection record. `recover` walks the same persistent body back to stock.

All submitted speech is trimmed to ten words. King and Queen orders are audible; worker speech remains in floating bubbles and the public record.

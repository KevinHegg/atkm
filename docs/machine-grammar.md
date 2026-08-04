# Machine Grammar

## Frozen Opening Set

Each team receives the same 24 persistent visible objects:

| Part definition | Quantity |
|---|---:|
| Short beam | 2 |
| Medium beam | 2 |
| Long beam | 2 |
| Octagonal hub | 4 |
| Short keyed axle | 1 |
| Long keyed axle | 1 |
| Spoked wheel | 2 |
| Deep-groove sheave | 2 |
| Rope-winding drum | 1 |
| Broad plank | 2 |
| Hooked rope | 2 |
| Iron-shod wedge | 3 |

There are no post-start part spawns. Parts retain one body ID from rack through
carry, connection, operation, impact, release, and recovery.

## Frozen Connections

Only four persistent connection classes exist:

| Class | Typical families | Physical joint |
|---|---|---|
| `TENON_LOCK` | beam, plank, hub | fixed |
| `AXLE_BEARING` | axle, hub or chassis bearing | revolute |
| `KEYED_COAXIAL` | wheel, sheave, or drum on axle | fixed coaxial |
| `ROPE_ATTACH` | hooked rope to load or sheave path | finite-length rope |

Family compatibility, port alignment, crew support, and tolerance checks must
all pass before a joint is created. A machine name never grants a connection.

## Simple Machines

The public rule catalog enumerates five ingredients:

- `lever`: a rigid effort arm with separated support and output contacts;
- `wheel-and-axle`: a rotating wheel, sheave, or drum sharing an axle;
- `pulley`: a tensioned rope path redirected by a sheave;
- `inclined-plane`: a plank or beam with a measured reachable rise;
- `wedge`: a tapered support or driven separator.

Compound rules combine those ingredients into six observable capabilities:
`climb`, `launch`, `strike`, `dislodge-timber`, `lift`, and `lower`.
Capabilities are declarations for strategy selection, not permissions to edit
physics. Every plan still expands into public actions.

## Live Compound Plans

The autonomous match evaluates six plans from the current physical facts. A
validated model choice or seeded weighted fallback selects one eligible Red
plan and one eligible Green plan, then both teams execute concurrently:

| Team | Compound machine | Ingredients | Required evidence |
|---|---|---|---|
| Red | Escalade ramp | wedge + inclined plane | wedge/plank contact and measured climber height gain |
| Red | Rescue hoist | wheel-and-axle + pulley + lever | keyed sheave, two rope attachments, tested tension, low slack, and raised proof load |
| Green | Wheel bombard | wedge + inclined spar + wheel | ramp contact, armed wheel contact, projectile/timber contact, shot travel, and displaced tower timber |
| Green | Wheeled ram | wheel-and-axle + lever | two keyed wheels, chassis bearing, striker tenon, wheel rotation, impact, and displaced tower timber |
| Green | Pivoted striker | lever + supported fulcrum | beam/fulcrum support, beam/timber contact, and displaced tower timber |
| Green | Counterweight sling | wheel-and-axle + pulley + lever | keyed sheave, routed and tensioned line, counterweight travel, projectile contact, and displaced tower timber |

The Green plan demonstrates crew choreography as part of the machine. One
worker holds the wheel on the narrow rail while the gunner takes a safe firing
stance; release passes directly into a collision-checked push. Impact can
remove tower support and decide the match, but there is no scripted damage call.

Every option publishes its required facts, observed facts, eligibility, rule
ID, parts, simple-machine ingredients, capabilities, and public action packet.
A model-led match also receives three legal crew permutations for every
observed plan: canonical, reversed crew, and rotated crew. The permutations
change which figures perform the declared public actions while keeping the
same visible parts and physical validation.
A disjoint pair of observed plans may also be composed into a hybrid recipe;
the hybrid publishes both component plan IDs and component part maps, then
receives the same three crew permutations. Shared non-target parts are
rejected, while target contacts remain physical evidence rather than scripted
damage.
A plan is unavailable when any required fact is absent. Its name never grants
physics authority or bypasses action validation.

An incomplete plan remains incomplete in the ledger. The team may rescan the
actual poses and attempt one different eligible class; it does not restore
parts or remove the first attempt's joints and impacts.

## Lifecycle

The observable lifecycle is:

`stored -> reserved -> fetched -> carried -> aligned/supported -> connected or operated -> tested -> released/damaged -> recoverable`

Interrupted work leaves every part at its last collision-valid pose. The
server is authoritative for character sweeps, carrying constraints, joints,
forces, impacts, and objective judgment.

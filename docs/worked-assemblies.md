# Human Acceptance Fixtures

These five fixtures use only one team's opening inventory. They exist for human
review and automated acceptance; their membership and steps are never included
in agent observations or prompts.

## Controlled Rescue Lowering

A cradle sling holds the shell. Two rope terminals connect the sling to a
reeved sheave line. A wheel/drum is keyed to an axle that turns in two bearing
nodes; a second worker brakes the drum. The proof load must hold, then descend
without slack reversal, tower contact, or a negative support margin.

Expected evidence: a continuous tension path, supported axle reaction,
reachable rotary input, load interface, positive failure margin, and observable
`redirect_force`, `hold_load`, and `lower_load` capabilities.

## Pivoted Rolling Striker

A long spar pivots in a grounded bearing node. A broad plank and second bearing
brace the reaction side; a wheel/drum on an axle supplies a reachable effort
input. The output end must strike a physical target only after a low-force proof
stroke.

Expected evidence: separated pivot, effort, and output contacts; a supported
load path; clearance through the complete swing; and observable `push`,
`multiply_force`, `aim`, and `strike` behavior.

## Dual-Use Ramp And Deck

A broad plank spans two unequal supported elevations made from keyed spars and
bearing nodes. In its inclined state it carries a wheel/drum upward; after one
support is repositioned it becomes a level work deck without spawning or
replacing any member.

Expected evidence: continuous supported face, two reactions, positive tipping
margin, rolling contact, and observable `support`, `transport`, and
`multiply_force` capabilities.

## Physical Sabotage

A wedge jams an accessible wheel/drum against its bearing frame while an enemy
worker blocks the operating station. The wheel must bind through contact; no
integrity number may change without a visible load, strike, slip, or removal.

Expected evidence: the wedge travels from inventory, enters a clearance volume,
creates compression and friction, raises binding risk, and remains recoverable.

## Load-Path Repair

Begin with a pulled keyed connection in a loaded spar frame. Workers support the
load, unload and align the damaged joint, reconnect it with the captive key, and
repeat the proof force. Repair succeeds only when the local port poses are back
inside distance and angle tolerance.

Expected evidence: persistent damaged state, temporary support, actual
realignment, a recreated physical joint, restored load path, and a higher
measured failure margin.

## Near-Miss Matrix

Each simple-machine analyzer is checked against disconnected parts, a missing
reaction/support, and a compatible-looking but incorrect port topology. Tests
rename instance IDs so recognizers cannot depend on fixture names or graph
hashes.

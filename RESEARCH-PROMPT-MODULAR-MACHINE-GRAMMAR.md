# Deep Research Prompt: A Period Modular Machine Grammar for All the King's Men

I am designing a real-time 2.5D/3D physics game called *All the King's Men*. Humpty Dumpty is the Egg King and begins upright on a central stone-and-heavy-timber pier. Three King's men must bring him to the stage floor intact and upright. Three Queen's men must crack him before or during the landing. The teams can cooperate internally, fight, steal, block, detach, sabotage, repair, and repurpose parts. A match lasts at most ten minutes.

The core of the game must be visible, physically coherent construction. Each team starts with the same fixed kit of loose pieces arranged along its outer edge of the stage. Workers must fetch parts, carry them through the world, align compatible connection points, connect them, test the resulting assembly, and operate it. Parts must never appear from nowhere. A deterministic physics engine is authoritative.

The design goal is not a catalog of prefabricated machines or recipes. It is a small, learnable, period-credible construction grammar whose neutral affordances let reasoning models invent useful compound machines. Think about the openness of Tinkertoy hubs and rods, the rigid geometry and lateral snap connections of K'NEX, and the experimental progression of the Thames & Kosmos Simple Machines kit, translated into wood, iron, bronze, leather, hemp, horn, sinew, stone, pegs, pins, sockets, and bearings.

## Starting Sources

Begin with these sources, then expand to primary sources, museum collections, patents, official manuals, engineering texts, and peer-reviewed work:

- Thames & Kosmos Simple Machines product and official experiment manual:
  - https://thamesandkosmos.com/products/simple-machines
  - https://thamesandkosmos.com/manuals/full/665069_Simple_Machines_Manual.pdf
- K'NEX Education Simple Machines teacher guides and K'NEX rod-and-connector patents, especially the lateral snap, 45-degree socket geometry, graduated rod lengths, axle-through-hub rotation, hinges, and adapters:
  - https://d2npjmct0hwe3x.cloudfront.net/wp-content/uploads/manuals/Education-Simple-Machines-Deluxe-Pulleys-Teachers-Guide-79520.pdf
  - https://patents.google.com/patent/EP2875849A1/en
  - https://patents.google.com/patent/US20060276100A1/en
- Official Hasbro Tinkertoy part inventories, especially rods, spools, couplings, elbows, tubes, rail holders, and pulleys:
  - https://instructions.hasbro.com/en-us/instruction/tinkertoy-classic-junior-builder-set
  - https://instructions.hasbro.com/en-us/instruction/tinkertoy-mini-set
- Historical machine evidence from museum and public-history collections, including windlasses, capstans, cranes, gin rigs, cannon carriages, elevating screws, crossbows, cranequins, rack-and-pinion winders, block and tackle, wedges, and wheeled transport:
  - https://collection.sciencemuseumgroup.org.uk/objects/co1946/compound-axis-in-peritrochio
  - https://www.metmuseum.org/art/collection/search/35797
  - https://www.metmuseum.org/art/collection/search/33739
  - https://www.nps.gov/common/uploads/teachers/lessonplans/FOPU%20Simple%20Machines%20Teacher-led%20Field%20Trip%20Lesson.pdf
  - https://www.loc.gov/item/2021666747/

Distinguish source-backed historical or mechanical facts from your design inferences. Give direct links and page numbers for manuals and papers. Do not use retailer descriptions as the sole support for technical claims.

## Research Questions

### 1. The minimum construction grammar

Propose the smallest useful family of reusable primitives that can express all six classical simple machines and many compound machines. Consider:

- structural members: short, medium, and long spars; planks; frames; decks; braces
- nodes: pegged hubs, gussets, bearing blocks, sockets, eyes, cleats, guides
- rotational parts: axle pins, sleeves, wheels, drums, sheaves, gears, ratchets
- translational parts: rails, sliders, racks, threaded shafts, nuts, wedges
- flexible parts: rope, chain, leather belt, sling, net
- energy parts: counterweights, torsion bundles, bows, leaf springs, catches
- load interfaces: hooks, cradles, cups, platforms, shields, chocks

Do not assume every item belongs in the final kit. Explain which pieces are fundamental, which are useful extensions, and which should be omitted because they create confusion or duplicate another affordance.

### 2. Connection grammar

Define a small set of visible, mechanically distinct connection types. Candidates include rigid peg, keyed socket, pinned hinge, axle-in-bearing, sliding sleeve, hook-and-eye, rope cleat, belt-on-wheel, gear mesh, rack mesh, threaded pair, wedge lock, and catch.

For every connection type specify:

- compatible port types and mating rule
- degrees of freedom before and after connection
- alignment and proximity tolerances
- whether workers need one or two hands, one or two workers, or temporary support
- connection time and interruption behavior
- transmitted forces and torques
- safe working load and failure mode
- visible and audible feedback for alignment, connection, loading, slipping, and failure
- whether it can be detached under load

Recommend whether the kit should use a universal connector with variants, several typed connectors, or a hybrid. Explain how the choice affects physical legibility, combinatorial creativity, agent error rate, and computational cost.

### 3. Six simple machines as emergent configurations

For lever, wheel and axle, pulley, inclined plane, wedge, and screw, show how each emerges from the shared primitives. Do not define a machine by a hidden label. Define it by topology, geometry, joints, contacts, and load path.

For each one provide:

- minimum connected parts
- required support or anchoring
- valid geometric ranges
- input and output motion
- ideal mechanical advantage
- friction and efficiency considerations
- stability and common failure modes
- obvious visual cues that let a spectator understand what it is doing
- two or more alternative constructions using the same kit

Treat gears, ratchets, cams, cranks, linkages, springs, and counterweights as transmission, control, or energy primitives rather than incorrectly adding them to the classical six.

### 4. Compound machines and novel solutions

Analyze how the grammar can produce useful families without giving the agents recipes. Include cranes, gin poles, windlasses, capstans, block and tackle, treadwheels, carts, rollers, ladders, scaffolds, ramps, lever jacks, screw jacks, hoists, slings, cradles, grapnels, drawbridges, barricades, crossbows, stone throwers, traps, shields, and machine-disabling tools.

For each family, identify the functional subassemblies and force-and-motion chain. Explain how a physics validator can recognize capabilities such as support, lift, lower, pull, push, roll, climb, aim, launch, cushion, store energy, release energy, restrain, and redirect without matching a named blueprint.

### 5. Period credibility

Assume a visually coherent late-medieval to early-modern fortress theatre rather than strict reconstruction of one year. Build a historical credibility matrix for each proposed part and material:

- strongly attested
- plausible adaptation
- anachronistic or misleading

Pay special attention to wooden screws, iron and bronze bearings, gears and racks, ratchets, coil springs versus leaf, bow, or torsion springs, iron tires, hemp rope, chain, leather belts, standardized sockets, and quick-release connectors. When a game-friendly snap connection is not historical, propose a visually period-credible abstraction and label it honestly as an abstraction.

### 6. Physics model

Recommend authoritative simulation rules for loose pieces and assemblies:

- rigid-body shapes, mass, center of mass, inertia, friction, restitution, damping
- collision layers and continuous collision detection
- joint types, motor limits, break forces, break torques, backlash, and compliance
- support graph, grounding, load path, tipping, buckling, slipping, binding, rope tension, belt slip, gear mesh, and projectile impact
- how to prevent floating parts, tunneling, interpenetration, and agents walking through solids
- how to move carried parts without teleporting them or turning them into nonphysical ghosts
- how to reconcile a server-authoritative 2D planning model with a 3D PlayCanvas/Ammo presentation, or whether one physics world should become authoritative

Give concrete parameter ranges in SI units for a stylized but coherent simulation. Explain which calculations should be exact, approximate, or presentation-only.

### 7. Agent-facing affordances

Design a compact, neutral object schema for reasoning models. Each loose part should report only physically useful facts, not suggested strategies. Include:

- id, type, material, dimensions, mass, pose, velocity, ownership, integrity
- ports with local pose, normal, compatibility, occupancy, and joint type
- load, stress, support, reachability, and current carrier
- intrinsic affordances and explicit non-affordances
- nearby compatible ports and estimated fetch, align, connect, and operate costs

Each assembly should report its connection graph, grounded members, free ports, moving degrees of freedom, input interfaces, output interfaces, derived capabilities, stability, mechanical advantage or ratio, current load, predicted failure margin, and operating clearance.

Provide concise TypeScript interfaces and compact JSON examples for one loose part, one partly built assembly, and one working compound machine. Estimate token cost.

### 8. Legal action vocabulary and visible work

Propose a small action vocabulary that lets agents coordinate real work without issuing low-level animation commands. Consider reserve, fetch, carry, support, align, connect, detach, anchor, reeve, tension, load, operate, test, guard, strike, and recover.

Define preconditions, duration, worker count, interruption rules, physical state changes, failure results, and observable animation stages for each action. A spectator must see the piece leave storage, be carried, aligned, clicked into place, tested, and operated. Agents should be able to talk while working.

### 9. Symmetric opening kit

Recommend one fixed mirrored inventory for each team. It must fit clearly along the outer stage edges, leave the central work area open, and offer meaningful tradeoffs. Prefer 18 to 30 visually distinct loose objects per side rather than a heap of tiny fittings. Small pins or pegs may be represented as attached connector hardware rather than individual floor objects.

For every item give quantity, dimensions, mass, ports, and unique contribution to the design space. Show which six simple machines and which compound-machine families are reachable from that exact inventory. Identify dead pieces, dominant pieces, and likely balance problems.

### 10. Evaluation plan

Create benchmarks that distinguish genuine mechanical reasoning from random snapping or memorized recipes. Include:

- isolated tests for every connection and simple machine
- load and failure tests
- partial-assembly completion tests
- alternate-solution puzzles
- sabotage and repair tests
- coordinated multi-worker tasks
- spectator-legibility checks
- novelty metrics based on topology and function, not cosmetic part order
- deterministic replay and regression checks

Define measurable success criteria for construction frequency, useful-machine completion, idle time, path interference, physics violations, tactical diversity, match duration, and win balance.

## Required Deliverables

Return a report with:

1. Executive recommendation and the key design decision.
2. Source review with facts separated from inferences.
3. Period credibility matrix.
4. Recommended primitive inventory and connection grammar.
5. Six emergent simple-machine specifications.
6. Compound capability derivation rules.
7. Physics and failure model.
8. Agent observation and action schemas.
9. Fixed symmetric opening kit.
10. Worked examples of at least three novel assemblies, including one rescue aid, one offensive machine, and one dual-use or sabotage machine.
11. Implementation sequence for a TypeScript, Rapier/Ammo, PlayCanvas game.
12. Test plan and balance risks.
13. A machine-readable JSON appendix containing the proposed parts, ports, compatibility matrix, materials, and affordances.

Favor a coherent, small grammar over a long parts catalog. Be critical. Identify where historical realism, toy-like snapping, reliable physics, agent comprehension, and spectator readability conflict, and recommend explicit compromises.

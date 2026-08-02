# Research Synthesis and Claims Ledger

The local deep-research file is a summary, not the full artifact it mentions. The implementation therefore uses only claims supported by the supplied text or the primary and official sources below. Connector dimensions, load limits, and pacing values are design decisions for this game, not reconstructed historical specifications.

| Class | Claim and implementation consequence | Evidence |
|---|---|---|
| `ENGINEERING_FACT` | The six classical simple machines addressed by the game are lever, wheel and axle, pulley, inclined plane, wedge, and screw. They can combine to increase mechanical advantage. The validators therefore derive each primitive independently and compound capabilities only through connected load paths. | National Park Service, *Simple Machines for a Complex Job*, printed pp. 1-3, PDF indexes 0-2, especially the list on p. 1 and gin description on p. 2: [official PDF](https://www.nps.gov/common/uploads/teachers/lessonplans/FOPU%20Simple%20Machines%20Teacher-led%20Field%20Trip%20Lesson.pdf). |
| `HISTORICAL_FACT` | Fort cannon work combined rope, pulleys, a roller or drum, a hook, and a lever; the NPS guide says using lever and pulleys together increased the gin's mechanical advantage. This supports period-styled compound lifting, not a prefabricated gin part. | NPS, printed p. 2, PDF index 1: [official PDF](https://www.nps.gov/common/uploads/teachers/lessonplans/FOPU%20Simple%20Machines%20Teacher-led%20Field%20Trip%20Lesson.pdf). |
| `HISTORICAL_FACT` | A ca. 1505-19 cranequin in the Metropolitan Museum uses rack-and-pinion action and steel, wood, and copper alloy. This supports visible geared or threaded force conversion as a period-credible extension. | The Met, *Cranequin from the Armory of Emperor Maximilan I*, object 2012.4: [collection record](https://www.metmuseum.org/art/collection/search/35797). |
| `HISTORICAL_FACT` | A compound axis demonstration uses pulleys, steel axles, an eight-to-forty tooth gear pair, cord, brass, steel, mahogany, and cotton. This is later scientific apparatus, not medieval evidence, but demonstrates readable chained ratios. | Science Museum Group, *Compound Axis in Peritrochio*, object 1927-1873: [collection record](https://collection.sciencemuseumgroup.org.uk/objects/co1946/compound-axis-in-peritrochio). |
| `ENGINEERING_FACT` | K'NEX rod and connector systems distinguish rigid rod sockets, rotational hubs, graduated lengths, and lateral snap engagement. Compact typed parts can therefore produce more useful combinations than many one-purpose objects. | EP2875849A1, paragraphs 99-124 and figs. 1-8: [Google Patents](https://patents.google.com/patent/EP2875849A1/en). US20060276100A1, paragraphs 136-182 and claim 1: [Google Patents](https://patents.google.com/patent/US20060276100A1/en). |
| `DESIGN_INFERENCE` | Three spar lengths are enough for the current vertical slice. More lengths increase stock clutter faster than they increase mechanically distinct behavior. | Inferred from the patent's graduated-length principle and the game's 24-object budget. |
| `GAME_ABSTRACTION` | Captive pegs, keyed sockets, and large visible port markers stand in for a standardized snap grammar. They are dressed as iron-collared timber fittings, not claimed as a historical construction set. | The snap behavior is inspired by construction-toy legibility; period styling is an explicit fictionalization. |
| `DESIGN_INFERENCE` | Pins and retainers are captive hardware and do not count as loose floor objects. This preserves readable silhouettes and prevents dozens of tiny physics bodies. | Derived from spectator readability, browser performance, and the prompt's inventory rule. |
| `ENGINEERING_FACT` | Mechanical advantage is meaningful only with a reaction, input, output, and load path. Merely placing a wheel, rope, or spar in the same assembly does not create the corresponding machine. | Standard statics and kinematics principle implemented through actual port-edge tests and support evidence. |
| `GAME_ABSTRACTION` | The 2D Rapier world is the sole outcome authority while PlayCanvas renders the stage in 2.5D. The depth lane is measured and collision-aware, but joints are not yet full 3D rigid-body constraints. | Architectural compromise documented in `physics-architecture-decision.md`. |
| `UNCERTAIN` | The exact timber species, bearing alloys, and safe loads would vary greatly by place and date. Current values are tuned comparative parameters, not conservation-grade material data. | No single supplied source establishes exact values for this fictional stage kit. |

## Admission Decisions

`fundamental`: three spar lengths, deck, bearing block, axle, wheel, drum, sheave block, rope, wedge, hook, and sling.

`extension`: coarse wooden screw spindle and nut. They add a mechanically distinct helical constraint that cannot be composed legibly from the fundamental set during one match.

`omit`: loose pegs, separate nails, saws, hammers, gears, rack, spring, pawl, chain, universal hub, and prefabricated ladder/crossbow/cart/crane. Captive hardware remains visible on host parts. Gears and springs are the highest-value later extensions after the authoritative world supports their motion robustly.

## Explicit Compromises

- Historical material language yields to oversized connector silhouettes at normal camera distance.
- The game uses fixed port tolerances and comparative safe loads for robust play.
- Rope reeving is represented by typed rope-to-groove edges; a multi-segment 3D rope solver remains future work.
- The inventory is deterministic like a chess opening. Variation comes from decisions, interference, failure, and geometry rather than random stock.

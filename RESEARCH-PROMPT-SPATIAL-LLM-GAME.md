# Research Prompt: Spatial Reasoning for an LLM-Driven Physics Game

I am designing a real-time 2.5D/3D stage game in which two teams of LLM-controlled agents manipulate the same fixed inventory of snap-fit simple-machine parts. Humpty Dumpty, the Egg King, begins atop a central stone-and-timber tower. His team must bring him to the floor intact and upright. The Queen's team must crack him first. Both teams may construct, operate, steal, detach, block, sabotage, or weaponize parts.

The stage floor uses metric Cartesian coordinates:

- `x`: left to right
- `y`: back to front
- `z`: height above the floor

Every actor, loose part, assembly, structure, projectile, and work zone has a position `[x,y,z]`, dimensions `[width,depth,height]`, orientation `[rx,ry,rz]`, velocity, mass, ownership, connections, capabilities, and integrity. A deterministic physics engine remains authoritative. Models submit intentions and legal actions; they do not directly set physics state.

Research how other agent simulations, RTS games, robotics systems, automated planners, and embodied-AI benchmarks represent complicated spatial worlds for frequent reasoning calls. Prioritize primary sources, official technical documentation, and published papers.

Please answer these questions:

1. What observation/state representations best preserve useful 3D geometry while staying compact enough for model calls every 5-8 seconds?
2. How should exact scene-graph state, semantic affordance graphs, tactical summaries, and recent event deltas be layered?
3. Which ideas from PDDL, behavior trees, blackboard systems, influence maps, utility AI, robotics world models, and entity-component systems transfer well?
4. How can action schemas expose neutral physical affordances without quietly prescribing a strategy?
5. How should reachability, collision, support, stability, mechanical advantage, line of sight, path cost, and time-to-completion be precomputed for a reasoning model?
6. How should multi-agent plans express dependencies, reservations, synchronization, interruption, sabotage, and recovery from failed actions?
7. How can a game reward novel solutions while validating every proposed action against deterministic geometry and physics?
8. What compact delta format should update a previous observation without repeatedly sending the whole stage?
9. What event-sourcing and snapshot cadence supports deterministic replay, scrubbing, and playback at 0.25x-4x?
10. Which existing games, research environments, or open-source projects are the closest technical precedents, and what specifically should be borrowed from each?

Deliver:

- A recommended architecture with clearly separated authoritative physics, spatial query, agent reasoning, action validation, and replay layers.
- A compact JSON example for one full observation and one delta update.
- TypeScript interfaces for observations, affordances, plans, actions, reservations, and action results.
- A token-budget estimate for one team decision with three workers.
- A proposed model-call schedule that remains responsive under 1-3 second network latency.
- Three worked examples: coordinated rescue construction, offensive compound-machine construction, and sabotage/recovery.
- A comparison table of at least five relevant precedents.
- Failure modes and concrete mitigations.
- Direct links and citations for all factual claims.

Do not redesign the visual style. Concentrate on world representation, physical reasoning, agent coordination, and replay.

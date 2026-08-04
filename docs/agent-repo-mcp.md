# Agent Repository Contract

The live strategy layer has a repository-facing contract at `/agent-context`.
It exposes `AGENTS.md`, the source-of-truth files, the frozen physics
invariants, and the names of the public agent tools. The current HTTP surface
is the local MCP-style adapter for the game; an external MCP transport can
wrap the same functions later without changing the strategy contract.

## Public surfaces

| Surface | Purpose |
|---|---|
| `/agent-context` | Read the repository contract and invariants |
| `/rules` | Read objectives and enumerable figure rules |
| `/contraptions?team=king\|queen` | Enumerate observed machine recipes and legal action counts |
| `/archive` | List durable public match records |
| `/archive/:id` | Read public replay snapshots for one record |

The model request includes the same contract summary. It receives observed
facts, attempted recipe IDs, and an advertised option list. It may select a
canonical machine or a generated crew permutation. The server validates every
ID before action execution.

## Recipe variation

`server/core/contraption-grammar.ts` expands each observed compound machine
into the canonical crew order, a reversed crew order, and a rotated crew order.
Those variants reuse the visible parts and connection classes but remap which
figures perform each public action. A route block, failed contact, or illegal
packet leaves evidence in the world and causes the team to reassess.

The grammar also composes plans when their non-target parts are disjoint. The
current public hybrid is a pivoted striker joined to a counterweight sling;
its component parts and action packets remain separately enumerable so the
referee can judge each impact against Rapier state. Hybrid variants receive
the same crew permutations as base plans.

This is deliberately an extension point, not a physics shortcut. New recipes
must be derived from visible facts, publish their simple-machine ingredients,
and expand to legal action requests. They cannot invent parts, connections,
forces, transforms, or engine handles.

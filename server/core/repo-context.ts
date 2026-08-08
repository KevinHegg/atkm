export const REPO_AGENT_CONTEXT = {
  contractVersion: "canonical-siege-affordances-v2",
  authority: "The deterministic siege rules decide tactical outcomes; Rapier 3D is the only physical authority.",
  sourceOfTruth: [
    "AGENTS.md",
    "shared/core-protocol.ts",
    "shared/siege-equipment.ts",
    "server/core/siege-rules.ts",
    "server/core/battle-director.ts",
    "server/core/physics.ts",
    "scripts/generate-public-replays.ts",
  ],
  invariants: [
    "Each team commits one advertised unit, action, and target per turn.",
    "Both sealed orders reveal together and resolve simultaneously.",
    "Ammunition, integrity, cooldowns, cover, and the one-use catch remain finite and public.",
    "Seeded commanders are deterministic and cannot invent private actions or outcomes.",
    "Every unit, crew role, tool, munition, legal target, and drill step comes from the canonical equipment catalog.",
    "A physical effect cannot begin before its visible canonical drill reaches the declared effect stage.",
    "The construction kit is an isolated engineering lab and is not spawned in the main battle.",
  ],
  mcpTools: [
    "get_repo_contract",
    "inspect_current_battle",
    "list_legal_siege_orders",
    "inspect_replay_archive",
  ],
} as const;

export const REPO_AGENT_CONTEXT_TEXT = [
  `Repository contract ${REPO_AGENT_CONTEXT.contractVersion}.`,
  REPO_AGENT_CONTEXT.authority,
  ...REPO_AGENT_CONTEXT.invariants,
  "The match is ten one-minute turns: Green wins by cracking Humpty; Red wins at the tenth bell or when Green exhausts its siege train.",
  "GitHub Pages is a static replay theatre; live commands require the local server.",
].join(" ");

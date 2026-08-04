export const REPO_AGENT_CONTEXT = {
  contractVersion: "contraption-repo-v2",
  authority: "Rapier 3D on the server is the only gameplay authority.",
  sourceOfTruth: [
    "AGENTS.md",
    "shared/agent-rules.ts",
    "server/core/compound-plans.ts",
    "server/core/special-plans.ts",
    "server/core/contraption-grammar.ts",
    "server/core/actions.ts",
  ],
  invariants: [
    "Use only the four frozen connection classes: TENON_LOCK, AXLE_BEARING, KEYED_COAXIAL, ROPE_ATTACH.",
    "Use only visible inventory parts, authored stage fixtures, and public legal actions.",
    "Never invent a body ID, transform, force, connection, or post-start part.",
    "A recipe is eligible only when its observed facts and public action packet are valid.",
    "A blocked or incomplete recipe leaves its physical evidence in place and triggers reassessment.",
  ],
  mcpTools: [
    "get_repo_contract",
    "list_observed_contraptions",
    "get_public_rules",
    "inspect_replay_archive",
  ],
} as const;

export const REPO_AGENT_CONTEXT_TEXT = [
  `Repository contract ${REPO_AGENT_CONTEXT.contractVersion}.`,
  REPO_AGENT_CONTEXT.authority,
  ...REPO_AGENT_CONTEXT.invariants,
  "Compose unexpected machines by permuting visible crew roles and simple-machine order; never bypass the action validator.",
  "The Queen's visible command post has two physical crown-bolt charges; Green can operate it and Red can strike it before it fires.",
].join(" ");

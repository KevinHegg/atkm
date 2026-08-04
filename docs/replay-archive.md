# Replay Archive

The server keeps a bounded archive of public `CoreSnapshot`
frames. Frames are sampled every half second and include visible bodies,
workers, connections, events, diagnostics, and match state. They contain no
Rapier handles or private agent prompts.

The browser Archive workspace can select a live or past record, play it at
0.25x, 0.5x, 1x, 2x, or 4x, step one frame at a time, scrub the timeline, and
return to the live theatre. Replay rendering never sends commands to the
server and never alters the live simulation.

Resetting or launching an organized match finalizes the current record before
the new simulation begins. Records are written as JSON under `.local/replays/`
and loaded again when the server starts. A live record is checkpointed every
few seconds, then finalized atomically, so a restart preserves the public
snapshots without touching the older `replays/` corpus.

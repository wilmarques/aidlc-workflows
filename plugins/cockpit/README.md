# cockpit — a localhost AI-DLC workbench

`cockpit` is an AIDLC plugin that renders a live, v2-style interface for the
run happening in this repository — inspired by the AWS *Collaborative AI-DLC*
workbench, but served entirely on **localhost** against the on-disk engine
state, and connected to the harness agent over **ACP** (Agent Client Protocol,
e.g. `devin acp`).

## What it shows

- **Pipeline** — every compiled stage grouped by phase with live status
  (pending / running / awaiting-approval / completed / skipped), derived from
  `aidlc-state.md` checkboxes + the audit trail.
- **Parallel unit lanes** — construction `UNIT_*` / `SWARM_*` audit events as
  per-unit lanes.
- **Gates** — stages parked at `awaiting-approval`, structured question files,
  and live ACP permission requests, all answerable in the browser.
- **Artifacts** — every file the run produced under the intent record dir,
  rendered as markdown.
- **Activity** — the audit trail (per-clone shards merge-sorted) as a feed.
- **Usage** — `usage-ledger.json` token counts and cost, workspace + per-stage
  + per-model.

## How it works

- `tools/cockpit-serve.ts` — the server. It reads `aidlc/spaces/<space>/intents/*`
  (state files, `audit/` shards, produced artifacts) and
  `<harness>/tools/data/stage-graph.json`, polls for changes, and pushes them to
  the browser over SSE. It also spawns the harness's ACP agent as a subprocess
  and speaks newline-delimited JSON-RPC, so you can prompt the agent, watch its
  stream, and answer `session/request_permission` gates from the page.
- `stages/ideation/cockpit-launch.md` — a conditional stage that runs right
  after `intent-capture`: it starts the server (`ensure`), records the URL in a
  `cockpit-session` artifact, and its approval gate doubles as "the workbench
  is live" acknowledgement.

## Run it

From an AI-DLC project with the plugin composed:

```bash
bun <harness-dir>/tools/cockpit-serve.ts serve            # foreground
bun <harness-dir>/tools/cockpit-serve.ts ensure           # detached; prints {"url": ...}
bun <harness-dir>/tools/cockpit-serve.ts stop             # stop the server
```

Then open the printed URL (default `http://127.0.0.1:4780`).

Flags: `--port N` · `--host H` · `--project-dir D` ·
`--agent "cmd args"` (default `devin acp`, env `COCKPIT_AGENT`) ·
`--no-agent` (read-only board, no ACP) · `--open`.

The ACP bridge advertises `fs` read/write capability confined to the project
dir and answers `session/request_permission` from the page; `terminal/*` is
declined via capabilities. If the agent needs auth (e.g. `devin-browser`),
`session/prompt` surfacing an auth error flips the status pill — authenticate
with `devin auth login` or via the agent's advertised auth methods.

No AWS infrastructure, no MCP tool server, no remote session — the engine's
own record dir is the database.

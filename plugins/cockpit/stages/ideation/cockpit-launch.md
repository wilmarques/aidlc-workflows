---
slug: cockpit-launch
number: 1.15
name: Cockpit Launch
plugin: cockpit
phase: ideation
execution: CONDITIONAL
condition: Execute once per intent when the cockpit plugin is enabled — starts the local workbench server so the rest of the run is observable in a browser. Skip when the cockpit tool is absent or the operator declines.
lead_agent: orchestrator
support_agents: []
mode: inline
produces:
  - cockpit-session
consumes: []
requires_stage:
  - intent-capture
scopes:
  - enterprise
  - feature
  - mvp
  - poc
  - bugfix
  - refactor
  - infra
  - security-patch
  - classic
  - workshop
  - express
inputs: the active intent's record dir (engine-resolved), the cockpit-serve tool under {{HARNESS_DIR}}/tools/
outputs: cockpit-session.md (under this stage's record dir, engine-resolved)
---

# Cockpit Launch

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

The cockpit plugin ships a localhost workbench (`cockpit-serve.ts`) that renders
this run's live state — stage pipeline, parallel unit lanes, human gates,
artifacts, audit feed, and token/cost usage — and bridges to the harness agent
over ACP. This stage starts that server once, records where it is listening,
and hands the URL to the human before the workflow proceeds.

## Steps

### Step 1: Start the Cockpit Server

Run `bun {{HARNESS_DIR}}/tools/cockpit-serve.ts ensure`.

The tool prints one JSON line: `{"status": ..., "url": "http://127.0.0.1:<port>", "port": <port>, "pid": <pid>}`.
`status` is `started` (a new detached server), `already-running` (a prior
launch or an earlier run left one up), or `degraded` (server could not start —
capture stderr, report it at the gate, and continue the workflow; the workbench
is observability, never a blocker).

### Step 2: Record the Session

Write `cockpit-session.md` under this stage's record dir with the URL, port,
pid, the agent command the server will spawn (default `devin acp`,
overridable with `COCKPIT_AGENT`), and a one-line note that the run can be
watched and steered from a browser at that URL.

### Step 3: Open the Approval Gate

Run `bun {{HARNESS_DIR}}/tools/aidlc-orchestrate.ts report --stage cockpit-launch --result awaiting-approval`.

### Step 4: Present Completion & Request Approval

Completion emoji: :rocket:
Review path: this stage's engine-resolved record dir.
Standard 2-option approval (Approve / Request Changes).
Tell the human the cockpit URL in the completion message — approving the gate
doubles as acknowledgement that the workbench is live. Report Approve with
`--result approved --user-input "<exact choice>"`; report Request Changes with
`--result rejected --user-input "<feedback>"`, revise the artifacts, then
report `--result revised` before re-presenting.

## Learn

While running this stage, record observations in the engine-created
`<record>/<phase>/<stage>/memory.md`. Treat it as an output-only target:
never read, probe, create, or initialize it. Follow the active harness's
diary-write discipline when inserting entries under Interpretations,
Deviations, Tradeoffs, and Open questions, each with an ISO 8601 timestamp.

Stage files are immutable framework artefacts — the ritual writes into the
harness, not into this file.

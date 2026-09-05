# PR #996 — Multi-Phase Agent Execution Plan

## 1. Purpose and status

This plan organizes PR #996 review remediation using the repository's AI-DLC agents, stage definitions, orchestration rules, and evidence-based gates.

This document is self-contained: it includes the corrected review findings, implementation tasks, agent dispatch policy, dependencies, test procedures, evidence requirements, and delivery criteria. No companion planning document is required. Repository source references identify implementation targets and governing workflow contracts, not missing portions of the plan.

Prepared on 2026-09-05. The original code review examined commit `0211b5ff`, which matched the PR head at that time; GitHub reported a merge conflict and the authored version was `2.7.3`. Refresh all three facts before execution. This is a planning artifact, not a workflow execution record. No implementation, workflow initialization, approval, test completion, merge, or release is implied.

### Source feedback and corrections

The five source comments are listed chronologically; later corrections supersede earlier claims:

- https://github.com/awslabs/aidlc-workflows/pull/996#issuecomment-5500403527 — initial inventory, runner/persona restrictions, documentation and artifact hygiene.
- https://github.com/awslabs/aidlc-workflows/pull/996#issuecomment-5512822850 — retracts missing hook coverage; preserves the inner subagent guard; questions usage folding.
- https://github.com/awslabs/aidlc-workflows/pull/996#issuecomment-5513837643 — reports runtime/fallback changes merged; describes release-metadata conflicts, runner restrictions, and minimum-version concerns.
- https://github.com/awslabs/aidlc-workflows/pull/996#issuecomment-5514884204 — captured payload evidence, inert usage hooks, and corrected Desktop binary discovery.
- https://github.com/awslabs/aidlc-workflows/pull/996#issuecomment-5515825448 — observed onboarding truncation and portable guard-parity assertions.

| Finding | Implementation disposition |
|---|---|
| Alleged missing hook layer (“30 versus 17”) | Retracted. No speculative hook-wiring expansion; the review found equivalent functional coverage packaged differently. |
| Polls generating duplicate completion events | Existing inner `run_subagent` guard already avoids this; retain it and add regression proof. |
| Compiled runtime and `.devin` resolution fallback | Reported merged; inspect and retain rather than reimplement blindly. |
| Usage folding | Live CLI 3000.6.7 capture reported no `transcript_path`; remove both inert registrations, not the shared core facility. |
| Fixture realism | Capture reported `prompt_id` and tool-event `tool_use_id`, not `cwd` or `transcript_path`; some local fixtures already have `tool_use_id`. Separate captured and synthetic shapes. |
| Desktop binary | Desktop has a bundled binary off PATH; check it before declaring version verification unavailable. Discovery alone does not prove Desktop runs hooks. |
| Model-invocable runners and persona keys | Apply documented Devin-native triggers and allowlists during generation, including regeneration/composition. |
| Onboarding | Reported Devin output was 18,982 bytes and truncation was observed in live injection. Reduce shared content; the proposed shared-budget explanation is not proven. |
| Hygiene | `.devin-plan.md` was already removed; review root evidence and generated HTML without unapproved deletion. |

Historical counts, timing, versions, and merge status are evidence inputs, not permanent test constants. A read-only exploration subagent helped map responsibilities; actual stage-defined leads, modes, and reviewers take precedence over advisory assignments.

## 2. Workflow selection

### Recommended approach: a tailored brownfield remediation workflow

The stock `bugfix` scope is intentionally minimal: it skips ideation and executes initialization, reverse-engineering, requirements-analysis, code-generation, build-and-test, deployment-pipeline, and deployment-execution. It caps review at advisory and omits explicit unit decomposition and delivery planning.

This change spans hook enforcement, generated skills/personas, doctor discovery, shared onboarding, packaging, and live platform evidence. Prefer a human-approved composed workflow that retains the brownfield emphasis but includes explicit architecture boundaries, units, delivery planning, and sufficient Construction review.

Use the existing composer path to propose that graph when execution is authorized. The composer is `aidlc-composer-agent`; it proposes a workflow but does not approve it. Validate required artifact dependencies and the compiled graph before accepting it. Do not assume a CLI review override can elevate a scope's review cap: select a scope/composition whose effective policy supports the intended review.

### Requested stage set

- Initialization: `workspace-detection`, `workspace-scaffold`, `state-init`, as emitted by the engine for the current workspace.
- Inception: `reverse-engineering`, `requirements-analysis`, `practices-discovery`, `domain-design`, `units-generation`, `contract-design` where justified, and `delivery-planning`.
- Construction: applicable per-unit `functional-design`, `nfr-requirements`, and `nfr-design`; `code-generation` per unit; `build-and-test` once across completed units. Include `ci-pipeline` only if CI configuration changes are required.
- Operation: release preparation through `deployment-pipeline`; authorized delivery through `deployment-execution`. Use `performance-validation` only if selected by the approved graph for measured overhead validation.
- Ideation: skip product discovery, market research, mockups, and team formation unless a material new requirement is found. Existing review comments establish the remediation intent.

The phases below are execution milestones, not new engine stages. The approved graph and emitted directives determine actual order, conditional skips, artifact paths, and approval points. Never jump stages or fabricate receipts to match this document's headings.

## 3. Agent responsibilities and dispatch policy

| Agent | Responsibility in this effort |
|---|---|
| Orchestrator (`harness/devin/skills/aidlc/SKILL.md`) | Own delegation, context loading, questions, engine reporting, evidence checks, and human gates |
| `aidlc-composer-agent` | Propose the tailored stage graph when authorized |
| `aidlc-product-agent` | Turn corrected review feedback into requirements and user-visible acceptance criteria |
| `aidlc-product-lead-agent` | Independent review of requirements and other stages that explicitly declare it |
| `aidlc-developer-agent` | Inspect implementation; write regression tests and source changes; produce per-unit evidence |
| `aidlc-architect-agent` | Analyze shared/core boundaries, define units and contracts, integrate architecture decisions |
| `aidlc-architecture-reviewer-agent` | Independent review on declared design/code stages; findings and verdict, not implementation |
| `aidlc-delivery-agent` | Dependency graph, Bolt sequencing, platform dependencies, and delivery checkpoints |
| `aidlc-quality-agent` | Verification strategy, regression sensitivity, integrated test execution, evidence completeness |
| `aidlc-devsecops-agent` | Guard enforcement, least-privilege projection, coexistence risks, and safe fixture practices |
| `aidlc-pipeline-deploy-agent` | Discover build/release practices; packaging, reproducibility, CI, and release preparation |
| `aidlc-operations-agent` | Operational perspective on Desktop discovery, live installation evidence, and post-delivery limitations |

Design and compliance specialists are optional consultations only if onboarding usability or evidence-retention questions require them. No AWS platform work is expected; do not provision infrastructure just to exercise a generic lifecycle stage.

### Dispatch rules

1. Only the orchestrator dispatches agents. Delegates do not launch each other or approve workflow transitions.
2. Honor `directive.mode`:
   - `inline`: load the lead/support personas and work in the conductor context; do not dispatch support agents merely because they are listed.
   - `pipeline`: dispatch links sequentially in declared order and record each completed link before the next.
   - `subagent`: dispatch the lead; declared supports contribute against its draft; the lead integrates.
   - `mob`: use only when selected by the approved workflow, with bounded rounds and human resolution of judgment disagreements.
3. `reverse-engineering` is a developer-to-architect pipeline. `practices-discovery` is a release-engineer-led subagent stage with quality, developer, and security supports. These provide useful specialist parallelism without inventing new topology.
4. `code-generation` is a developer-led subagent stage with no declared support agents and an architecture reviewer. Do not append arbitrary support workers to it.
5. `build-and-test` is inline, led by quality with a security support perspective. Subagent authorization does not override that mode.
6. Reviewers are separate delegates when the directive names one. They operate within the reviewer protocol's allowed scope and review output, not as unrestricted builders or lifecycle operators.
7. Use native AIDLC profiles only when installed and available. The present CLI session's generic `subagent_explore`/`subagent_general` profiles are not proof that AIDLC profiles are installed. If unavailable at execution time, stop and resolve configuration or use a human-approved protocol-compatible fallback; do not silently substitute identities or mint misleading receipts.

## 4. Phase 0 — Baseline and execution readiness

**Objective:** Establish the exact source, supported environment, and approved execution boundary.

**Workflow mapping:** Initialization plus input preparation for reverse-engineering and practices-discovery.

**Owner:** Orchestrator; release/quality responsibilities are incorporated through the appropriate subsequent stage personas.

### Tasks

- Record branch, HEAD, upstream base, working-tree status, Bun version, CLI version, and available Desktop/platform environments.
- Recheck which review findings are already resolved. Preserve the retraction of the hook-count gap and the later Desktop correction.
- Inspect current merge conflicts and proposed integration strategy. Obtain specific approval before a rebase/history rewrite; a plan is not permission to force-push.
- Verify retained runtime-release and harness-resolution contributions rather than reimplementing them from old comments.
- Run the initial packaging check before regeneration and record baseline failures.
- Resolve/create the intended AI-DLC workspace through normal engine directives only after execution authorization.

**Outputs:** Baseline evidence, conflict classification, environment availability, and unresolved-decision list in engine-resolved records.

**Readiness checkpoint:** Human confirms remediation scope and any destructive integration action. Missing Desktop access is recorded as a validation dependency, not assumed support.

**Test linkage:** T01 and T12 in section 13; test environment and command order in section 8. For upstream integration, prefer a merge when preserving published history; re-evaluate the historical metadata-only conflict claim. Resolve `core/tools/aidlc-version.ts`, README badge, and changelog first, retaining upstream entries, then regenerate distributions. Never hand-resolve generated version copies or assume the historical “no re-bump needed” advice is still valid.

## 5. Phase 1 — Requirements and brownfield evidence

**Objective:** Convert the five comments into an authoritative, corrected requirements set.

### Stage execution

1. `reverse-engineering`: `aidlc-developer-agent` then `aidlc-architect-agent`, pipeline mode. Inspect adapter routing, generated frontmatter, doctor, onboarding rendering, plugin composition, and tests. Use the stage's canonical CodeKB output paths and freshness rules.
2. `requirements-analysis`: `aidlc-product-agent` as the inline lead; independent `aidlc-product-lead-agent` review as emitted.
3. `practices-discovery`: `aidlc-pipeline-deploy-agent` draft, then declared quality/developer/security contributions and lead integration. Collect actual build commands, policy constraints, release rules, and test infrastructure.

Actual sequencing follows graph dependencies, not the numbered list above.

### Requirements inventory

- R1: Remove inert Devin usage-hook registrations without dropping required enforcement.
- R2: Align fixtures with observed payloads and verify project-directory resolution.
- R3: Protect matcher coverage and prevent poll-induced completion records.
- R4: Make mutating runners user-only across generation/regeneration paths.
- R5: Project supported persona tool restrictions without breaking role capabilities.
- R6: Discover Desktop binaries and accurately distinguish supported, old, missing, and broken versions.
- R7: Reduce always-on content and preserve essential instructions plus install-local reference access.
- R8: Document and verify coexistence, retained capabilities, evidence hygiene, and cross-harness behavior.

**Outputs:** `requirements`, practices/evidence artifacts, and the following requirement-to-unit-to-test mapping, refined against fresh source evidence. This RFC is the planning input, not a substitute for required stage artifacts.

| Requirement | Implementation unit | Required verification |
|---|---|---|
| R1 | U1 | T02, L04 |
| R2 | U1 | T03 |
| R3 | U1 | T04–T06, L01, L04 |
| R4 | U2 | T07, L02 |
| R5 | U2 | T08, L03 |
| R6 | U3 | T09, L06–L07 |
| R7 | U4 | T10, L08 |
| R8 | U5, with integration across U1–U4 | T01, T11–T12, L05 |

All T/L cases are defined in sections 13–14; evidence and exit criteria are in section 15.

**Gate:** Human approves corrected acceptance criteria; advisory review findings are shown verbatim. Unknown live behavior remains an explicit question.

## 6. Phase 2 — Architecture, units, and delivery design

**Objective:** Define implementation boundaries before parallel work begins.

### Stage execution

- `domain-design`: architect-led, with supports and architecture review exactly as declared by the active directive; focus on existing components rather than inventing a new domain model.
- `units-generation`: architect-led inline with delivery perspective; independent architecture review.
- `contract-design`, if selected: capture shared generator and packaging contracts, environment/version behavior, and reference-resource availability.
- `delivery-planning`: delivery-led inline with architect support. Produce the Bolt plan and external dependency map.

### Proposed units

| Unit | Scope and primary authored surface | Verification |
|---|---|---|
| U1 — Hooks and adapter | `harness/devin/hooks.v1.json`, adapter, payload fixtures, matcher validation and associated tests | T02–T06, L01, L04 |
| U2 — Runner/persona projection | `core/tools/aidlc-runner-gen.ts`, `scripts/package.ts`, applicable plugin composition | T07–T08, L02–L03 |
| U3 — Doctor portability | `core/tools/aidlc-utility.ts`, deterministic binary-discovery fixtures | T09, L06–L07 |
| U4 — Onboarding budget | Shared onboarding template, fills, shipped on-demand reference material, render checks | T10, L08 |
| U5 — Integration and release evidence | Cross-cutting docs/coexistence, approved artifact hygiene, version synchronization, final packaging | T01, T11–T12, L05; final full matrix |

### Unit implementation specifications

#### U1 — Hooks, payloads, and guard contracts (P1)

Primary files: `harness/devin/hooks.v1.json`, `harness/devin/hooks/aidlc-devin-adapter.ts`, `tests/fixtures/devin-hook-payloads/payloads.json`, and `tests/unit/t221-reviewer-scope-hook.test.ts`, `t331-devin-packaging.test.ts`, `t332-devin-adapter.test.ts`. Select the packaging validation seam during design.

1. Remove `fold-usage` registrations from PreToolUse and PostToolUse. Retain the shared hook for harnesses with supported transcript data; do not remove unrelated cost capabilities.
2. Separate captured payload fixtures from synthetic compatibility/edge cases. Captured cases must not invent `cwd` or `transcript_path`; include observed `prompt_id`/`tool_use_id` where appropriate. Record capture version, event coverage, and provenance; do not extrapolate unseen lifecycle events.
3. Verify project-root resolution without payload cwd. Reviewed code uses `DEVIN_PROJECT_DIR → payload.cwd → process.cwd()`, not the broader AIDLC/script-path fallback described in one comment. Approve any behavioral expansion explicitly rather than accidentally introducing it through tests.
4. Preserve the log-subagent inner `run_subagent` guard and add poll-exclusion coverage.
5. Validate matcher tool names against supported Devin tools at packaging time. Permit intentionally empty matchers. For reviewer-scope, review-freeze, and plan-approval guards, assert compatible PreToolUse coverage rather than a specific explicit matcher string. Identify adapter subcommands independently of quoted paths.
6. Exercise actual guard denials and valid controls. Keep unrelated-tool pass-through behavior and existing security boundaries intact.

**Unit acceptance:** No inert usage dispatch; realistic payloads reach the correct project; polls append no completion records; invalid named matchers fail; intended protected operations remain blocked. T02–T06 pass.

#### U2 — User-only runners and persona permissions (P1)

Primary files: `core/tools/aidlc-runner-gen.ts`, `scripts/package.ts` (`projectTierFrontmatter`), and applicable paths in `scripts/plugin-hooks-template/compose.ts`.

1. Classify mutating stage, initialization, scope, and composition runners by behavior, not historical runner counts.
2. Emit `triggers: [user]` in Devin generation so regeneration inside installed projects preserves the policy. Do not rely on a one-time dist rewrite.
3. Remove unsupported `disallowedTools` and `maxTurns` from emitted Devin persona frontmatter; retain other harness contracts.
4. Project supported `allowed-tools` lists excluding `run_subagent` where delegation is prohibited, preserving each role's legitimate capabilities. Correct emitted prose that claims ignored keys provide enforcement.
5. Apply equivalent policy to relevant plugin composition/regeneration paths; verify actual plugin support rather than claiming unsupported paths are covered.

**Unit acceptance:** All classified mutating runners are user-only; persona restrictions use supported fields; generation and regeneration agree; no unintended other-harness changes. T07–T08 pass, with L02–L03 providing runtime proof.

#### U3 — Desktop-aware doctor and supported floor (P1)

Primary file: `core/tools/aidlc-utility.ts`, plus isolated discovery/version tests. The reviewed implementation pins `3000.3.0` and fails when no version is read.

1. Search PATH for `devin` first; on macOS only, then check `/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin`.
2. If neither candidate exists, report an advisory explicitly saying version verification is unavailable. Do not invent unmeasured Windows/Linux bundle locations.
3. Raise the floor to `3000.3.22`, with the documented exit-code-2/stderr blocking compatibility rationale. Do not assert that every earlier version is universally incapable of blocking.
4. Treat an old version, failed version command, and unparseable/empty version output as failures, not missing-binary advisories. Report the selected binary's source/path. Do not silently bypass an old PATH binary by selecting a newer bundle.
5. Keep Desktop runtime support unverified until actual Desktop hook execution passes, independently of doctor discovery.

**Unit acceptance:** PATH and bundle versions are evaluated correctly; absent binaries produce an explicit unknown-status advisory; broken/old binaries fail. T09 passes. L06 proves real discovery; L07 separately proves Desktop enforcement.

#### U4 — Shared onboarding size and on-demand detail (P1)

Primary files: `core/templates/onboarding.md`, per-harness onboarding fills, packaging/resource projection, and rendered-content tests.

1. Compress AI-DLC Structure to a short navigation summary and consolidate the duplicate DocumentKB descriptions.
2. Move reference detail into a resource shipped with copied distributions. Repository-only `docs/` links are insufficient for installation-critical guidance.
3. Keep startup/resumption, approval boundaries, artifact locations, and untrusted-document handling near the start.
4. Enforce the human-approved project-owned byte limit across all harness onboarding outputs; proposed limit is ≤12 KiB. Preserve substantive guidance rather than meeting the budget by deleting safety instructions.
5. Describe the documented 32 KiB ceiling separately from observed earlier truncation. Do not claim the shared-budget hypothesis is proven or the chosen limit guarantees retention with arbitrary user rules.

**Unit acceptance:** All rendered files meet the agreed UTF-8 byte limit, preserve required instructions, and link to installed resources. T10 and live injection case L08 establish their respective static and runtime evidence.

#### U5 — Cross-cutting docs, hygiene, and release integration (P2 after P1 fixes)

Primary files: `docs/guide/harnesses/devin.md`, onboarding fills not owned by U4, `tests/harness/harness-matrix.ts`, `tests/unit/t239-documentation-parity.test.ts`, `core/tools/aidlc-version.ts`, `README.md`, and `CHANGELOG.md`.

1. Document minimum version, Desktop discovery versus execution, usage-ledger limitations, runner/persona policy, and onboarding constraints.
2. Explain that Claude compatibility imports include hooks and can duplicate AIDLC audit processing when both installations are active. Document and test how a user selects one hook source; do not silently disable all Claude imports for existing users.
3. Assert concrete documentation contracts, not counts of the word Devin. Search docs and README for stale paths, commands, versions, and flags whenever changing surfaces.
4. Preserve useful root-level evidence/provenance; propose any relocation and removal of redundant generated HTML for explicit approval. Verify `.devin-plan.md` remains removed. Do not delete user-owned evidence under a generic cleanup instruction.
5. Retest merged runtime-release and `.devin` fallback features and cross-harness/plugin contracts.
6. Select a free release version against current upstream; synchronize authored version, README badge, and changelog while preserving upstream entries. User-visible changes require the repository-prescribed bump; doc-only planning changes do not.
7. Regenerate all distributions using `bun scripts/package.ts`, review the generated diff, and require byte parity. Never hand-edit generated files.

**Unit acceptance:** T01 and T11–T12 pass; L05 validates coexistence guidance; no unsupported capability claims remain. Unapproved deletions and publication actions are deferred explicitly.

### Decisions to settle before code generation

- Accepted project-owned onboarding size limit; proposed ≤12 KiB is not a vendor guarantee.
- Exact persona tool sets and mutating-runner classification.
- Whether adapter fallback behavior changes or only realistic fixture coverage is needed.
- How matcher validation handles the intentionally broad empty matcher.
- Desktop support wording when live execution remains unverified.
- Evidence relocation and any deletion requiring explicit approval.
- Effective review class for Construction: prefer adversarial where supported by the approved scope/composition; never silently treat an advisory review as adversarial.

### Dependency and collision controls

U1, U2, U3, and U4 can be designed independently after shared contracts are approved. Implementation is sequential by default. Parallel unit execution requires an engine-supported grant/topology and isolated worktrees; user permission to use subagents is not automatically an autonomous Construction grant.

- U1 matcher validation and U2 projection may both touch `scripts/package.ts`: serialize those edits or assign one integration owner.
- Multiple units may extend `t331`/`t332`: assign test ownership before dispatch and serialize shared-file edits.
- U4 owns shared onboarding prose; U5 updates only remaining cross-cutting documentation after it lands.
- One integration owner performs shared release metadata updates and commits generated distributions. Never run concurrent writers over the same `dist/` tree.
- U5 depends on all preceding unit outputs; integrated build-and-test waits for every per-unit Construction stage.

**Outputs:** Component boundaries, unit DAG, contracts where needed, Bolt plan, source ownership, and test traceability.

**Gate:** Human confirms the design summary, unit plan, review policy, and unresolved operational risks before Construction.

## 7. Phase 3 — Per-unit implementation and independent review

**Objective:** Implement U1–U4 and then U5 with reproducible regression proof.

**Workflow mapping:** Applicable per-unit design stages followed by `code-generation` for each unit.

### Required loop for every unit

1. Load the unit's resolved context and design inputs; do not inject all units into every delegate.
2. Write the code-generation plan identifying files, assertions, test commands, and risks.
3. Complete the stage's native pre-code human approval flow. This RFC and a subagent assignment are not plan-approval receipts.
4. Write and run the targeted regression test; preserve the original failure and confirm it represents the intended defect rather than fixture setup failure.
5. Implement the smallest source change in `core/` or `harness/`, plus necessary generator/tests/docs changes. Never patch `dist/` by hand.
6. Run targeted red/green verification and approved regeneration in the isolated working context.
7. Produce the required `code-generation-plan`, `unit-test-instructions`, `code-summary`, and `traceability` artifacts; write `source-manifest.json` covering all changed source, including generator-written paths as required by the stage.
8. Orchestrator requests and dispatches `aidlc-architecture-reviewer-agent` through the review protocol. The developer does not self-review or launch the reviewer.
9. Honor effective review class:
   - Adversarial: bounded lead-only repair/review loop, using the emitted iteration limit.
   - Advisory: one normal-flow review, findings retained for human decision; no automatic repair loop masquerading as adversarial review.
10. Complete required sensors, learnings, and human gate before reporting the appropriate outcome once.

**Subagent brief:** Unit ID, exact task, current-unit input paths, accumulated rule bundle, permitted source boundaries, expected artifact paths, acceptance tests, known risks, and prohibition on delegated lifecycle transitions. Return produced paths, decisions, concerns, and next action rather than repeating artifact bodies.

**Exit evidence per unit:** Targeted test results, red/green proof, source manifest, review evidence, and genuine human disposition. Missing evidence blocks completion.

## 8. Phase 4 — Integrated verification and live acceptance

**Objective:** Prove that the assembled fixes work and do not regress other harnesses.

**Workflow mapping:** `build-and-test` once after all per-unit work; quality-led inline with security support perspective. Use its canonical artifacts, including `build-and-test-summary`, `build-test-results`, and `cross-unit-traceability`.

### Test entry criteria and environments

- Record implementation commit, upstream baseline, OS, Bun version, CLI version, and Desktop version where relevant. Check the working tree without overwriting unrelated changes.
- Use disposable installed-project fixtures copied from `dist/devin/`, deterministic workflow state/audit data, and sentinel application files. Never test denied mutations against a real project.
- Isolate Claude coexistence and global-rule experiments from actual user configuration. Approve fixture hooks through the supported trust flow, fully restart, and verify a benign hook fires before testing denial behavior.
- Keep deterministic runs free of live-model calls. Obtain approval for live sessions with model costs or external dependencies. Redact credentials, private prompts, and unrelated rules from retained evidence.

| Environment | Coverage |
|---|---|
| Linux with supported CLI | Deterministic suite and live CLI behavior |
| macOS with supported CLI | PATH discovery and live CLI smoke |
| macOS with Desktop | Real bundle discovery and Desktop hook execution |
| Native Windows where supported by project CI | Deterministic portability, quoting, and missing-bundle behavior |
| Executable version stubs | Below-floor, exact-floor, newer, malformed, empty, and failed commands |
| Actual minimum CLI if obtainable | Blocking compatibility at the advertised floor |

Version stubs prove doctor logic, not historical CLI behavior. If a real minimum-version build is unavailable, record the limitation and documentary basis for the floor.

### Ordered deterministic verification

Run from the repository root and capture each command, exit code, revision, and output.

**A. Inspect committed output before regeneration:**

```bash
git status --short
bun scripts/package.ts --check
```

A drift failure returns to implementation. Do not regenerate first and conceal stale committed distribution output.

**B. Focused regression checks:**

```bash
bash tests/run-tests.sh --unit --filter 't68-|t221-|t239-|t331-|t332-' --no-llm
```

Add exact filenames for new/extended runner, persona, doctor, onboarding, plugin, and coexistence tests to the execution manifest and run them in their actual tiers. The filter is only a starting set. Confirm the intended tests ran rather than accepting an empty selection.

**C. Full deterministic suite:**

```bash
bun run check
bash tests/run-tests.sh --ci --no-llm
bash tests/run-tests.sh --e2e --no-llm
```

`bun run check` includes packaging parity, type checking, and lint; `--ci` selects smoke, unit, and integration. These checks do not establish live CLI/Desktop support.

**D. Regeneration reproducibility, after A passes:**

```bash
bun scripts/package.ts
bun scripts/package.ts --check
git diff --exit-code -- dist
```

Require no tracked distribution changes against the tested implementation commit. Resolve intentionally uncommitted generated changes before final acceptance. Execute the detailed T01–T12 procedures in section 13 and regression sensitivity experiments in section 15; suite commands alone do not replace their assertions.

### Live acceptance

- L01: Actual tool blocking and human-approval recovery.
- L02–L03: Harness-enforced runner/persona restrictions; model cooperation alone is insufficient evidence.
- L04: Dispatch and audit uniqueness, including repeated polls.
- L05: Claude/Devin coexistence and the documented single-hook-source configuration.
- L06–L07: Real Desktop discovery and actual Desktop hook execution as separate results.
- L08: Live onboarding injection and install-local on-demand content.

External platform operators may collect evidence under the quality lead's procedure. They are evidence providers, not undeclared replacement workflow agents. Record exact versions, fixture commits, commands, artifact hashes, and redacted logs.

**Gate:** T01–T12 pass or documented baseline exceptions receive explicit human acceptance. Live cases are individually PASS, FAIL, BLOCKED, or NOT RUN. Desktop runtime support cannot be declared verified if only bundled-binary discovery passed. A required blocked case remains incomplete, not a green gate.

## 9. Phase 5 — Delivery preparation and authorized publication

**Objective:** Deliver a reproducible change with accurate support claims.

**Workflow mapping:** `deployment-pipeline` and `deployment-execution`, led by `aidlc-pipeline-deploy-agent` in their declared inline modes; load the operations support where emitted. For this repository, delivery is the established package/PR/release process, not invented cloud deployment.

### Tasks

- Reconfirm upstream integration and version availability immediately before finalizing metadata.
- Preserve upstream changelog entries and apply the repository's user-visible change policy once coherently.
- Verify documentation, moved evidence links, distribution parity, and clean intended diff.
- Assemble a requirement/unit/test evidence table and explicit remaining limitations.
- Prepare PR updates and release notes that distinguish verified CLI, unverified platform behavior, and advisory discovery results.
- Obtain current approval for commits/pushes/publication and any merge/rebase action. Previous permission to push the planning documents is not blanket approval for future release actions.
- Execute only authorized delivery steps; retain command outcomes and release identifiers.

**Gate:** Human authorizes delivery after reviewing evidence and limitations. If publication is not authorized, stop at a release-ready artifact; do not claim deployment-execution completed.

## 10. Phase 6 — Handoff and follow-up

**Objective:** Close review findings without losing known limitations.

**Owner:** Delivery/release owner with quality evidence and operations perspective. Run `feedback-optimization` only if present in the approved graph; otherwise this is a handoff checklist, not an invented completed stage.

- Map each of the five source comments to fixed, already-resolved, retracted, or explicitly deferred outcomes.
- Link implementation commits and exact test evidence.
- Record environment-sensitive baseline issues independently of newly introduced failures.
- Assign follow-up owners for unverified minimum-version, Desktop, Windows, or truncation-budget behavior.
- Preserve meaningful dissent and accepted risks rather than deleting them from summaries.
- Confirm no runtime guarantee exceeds the evidence collected.

**Completion:** The engine reports completion only after its actual required stages and gates are satisfied. Otherwise park at a valid boundary and report outstanding work.

## 11. Evidence, approvals, and recovery

- Runtime artifacts belong under the engine-resolved `<record>` within `aidlc/spaces/<active-space>/intents/<slug>-<id8>/`; this RFC remains the standalone planning input.
- Use emitted `produces`, `consumes`, memory paths, and per-unit directories; do not hard-code stage output locations from this plan.
- Declared support participants on subagent/mob stages write their own contribution files with the mandatory `**Collaborator:** <agent-slug>` first line, Contribution, and Positions sections. Lead owns final stage artifacts.
- Pipeline links require durable completion receipts; artifact presence alone is insufficient.
- Review requests precede dispatch; review scope/freeze rules remain enforced. A stale receipt requires the documented recovery flow, not direct edits or guard disabling.
- Human questions and summary confirmations use the stage protocol. Report state through the orchestrator, never by hand-editing state/audit or fabricating approvals.
- If a subagent fails, retry once with reduced context; if it still fails, present the protocol's human recovery choices and leave unfinished work clearly recorded.
- Do not disable sensors, lower thresholds, alter security controls, or use evidence-bypass environment variables to obtain a green result.

## 12. Source references

Repository contracts consulted:

- `core/scopes/aidlc-bugfix.md`
- `core/agents/aidlc-*-agent.md`
- `harness/devin/skills/aidlc/SKILL.md`
- `core/aidlc-common/protocols/stage-protocol-ensemble.md`
- `core/aidlc-common/protocols/stage-protocol-reviewer.md`
- `core/aidlc-common/stages/initialization/`
- `core/aidlc-common/stages/inception/{reverse-engineering,requirements-analysis,practices-discovery,domain-design,units-generation,contract-design,delivery-planning}.md`
- `core/aidlc-common/stages/construction/{functional-design,code-generation,build-and-test}.md`
- `core/aidlc-common/stages/operation/{deployment-pipeline,deployment-execution}.md`

Re-read the emitted directives and current stage definitions at execution time. This plan does not freeze repository contracts or override subsequent approved workflow changes.

## 13. Deterministic test specifications

These are executable acceptance procedures to implement in the existing test infrastructure and run after each relevant fix. They define required assertions, not claims that tests already exist or have passed. Record the actual test filenames against each ID.

### T01 — Release metadata and integration

**Procedure:** Run version/changelog synchronization and initial packaging parity; compare release metadata to the selected upstream baseline.

**Expected:** Authored version, README badge, and newest changelog heading agree; no duplicate headings; upstream entries are retained; every generated version matches. No manually patched distribution copies.

### T02 — Inert usage registration removal

**Procedure:** Parse emitted Devin hooks and enumerate targets by event. Assert neither PreToolUse nor PostToolUse registers `fold-usage`. Exercise representative events with fixture-local subprocess dispatch instrumentation.

**Expected:** Zero usage-fold subprocesses from Devin registrations; remaining required hooks still dispatch; shared core availability and other harness wiring remain unchanged unless explicitly approved.

**Evidence:** Event-to-target inventory and dispatch trace. Timing is optional supporting evidence, not an arbitrary pass threshold.

### T03 — Realistic payloads and project resolution

**Procedure:** Run captured-shape payloads without `cwd`/`transcript_path`, with measured `prompt_id`/`tool_use_id` where appropriate. Set DEVIN_PROJECT_DIR to an isolated fixture root while running from another directory; repeat with spaces in the root. Test no-environment fallback from the intended fixture cwd and any newly approved precedence paths separately.

**Expected:** Reads/writes target the intended fixture, session identity is retained, and no unrelated directory is mutated. Synthetic compatibility fields are distinguishable from captured cases. Each fallback agrees with the implementation contract.

**Negative controls:** Missing optional fields, malformed input, unknown tools, and unsupported event shapes follow documented behavior without accidental mutations. Do not change malformed-input policy solely to make a test pass.

### T04 — Poll exclusion in subagent completion logging

**Procedure:** Deliver one valid run_subagent completion followed by two read_subagent polls for the same delegate. Also feed a poll directly to the log-subagent target to exercise its inner guard even when matcher filtering is bypassed.

**Expected:** Exactly one correctly attributed completion event; polls append neither completions nor unknown-agent entries.

**Boundary:** This proves poll exclusion, not deduplication of repeated run_subagent deliveries unless separately promised and tested.

### T05 — Matcher validity and coverage

**Procedure:** Parse registrations and identify adapter subcommands without relying on path quoting. Verify reviewer-scope, review-freeze, and plan-approval PreToolUse registrations share the intended compatible coverage. Exercise empty and explicit read/write/shell matchers. Introduce an invalid named tool in a disposable packaging fixture.

**Expected:** Invalid tool names fail validation with a useful error; intentional empty matchers pass; relevant tools are covered and unrelated tools pass through. Each explicitly matched tool has a fixture or documented equivalent behavioral coverage. Do not pin a historical matcher string or tool count.

### T06 — Guard denial and allowed controls

**Procedure:** Invoke emitted adapters with realistic payloads against deterministic state fixtures:

| State | Attempt | Expected |
|---|---|---|
| Plan approval pending | Edit protected application sentinel | Blocking result; sentinel unchanged |
| Plan legitimately approved | Same eligible edit | Allowed |
| Reviewer scope active | Read outside allowed scope | Blocking result |
| Reviewer scope active | Read within scope | Allowed |
| Review receipt freeze active | Write frozen deliverable | Blocking result; bytes unchanged |
| Freeze legitimately cleared | Same eligible write | Allowed |
| Protected workflow state | Direct unsupported mutation | Blocking result |
| Valid framework transition | Authorized engine operation | Allowed |
| Protected context | Unrelated supported benign tool | Not spuriously denied |

Assert the adapter's blocking exit/output convention and meaningful reason. For filesystem assertions, use a fixture dispatcher that executes the operation only on allowance; directly calling an adapter does not itself perform the requested tool action. Test relevant write and shell forms, not only edit. Live refusal and real human approval are independently required in L01; do not manufacture live approval receipts.

### T07 — User-only runner generation

**Procedure:** Enumerate mutating runners using graph/generator classification, parse emitted skills, regenerate installed runners, and repeat. Include plugin-contributed runners where supported.

**Expected:** Every classified runner has `triggers: [user]` semantics without malformed/duplicate keys. Regeneration retains the policy; non-Devin output changes only where explicitly intended.

### T08 — Persona projection

**Procedure:** Parse all emitted Devin personas and applicable composed plugin profiles. Check unsupported keys are absent, allowlists are valid, and developer/reviewer/composer roles retain required capabilities.

**Expected:** `run_subagent` is unavailable where delegation is prohibited; role-appropriate tools remain; emitted prose does not claim ignored `disallowedTools`/`maxTurns` enforcement. Other harness restrictions remain intact.

### T09 — Doctor binary discovery and versions

**Procedure:** Use executable stubs and injectable discovery paths, not modifications to real bundles or installed binaries.

| Case | Expected |
|---|---|
| Supported PATH binary and bundle both present | PATH wins; selected source reported |
| PATH absent, supported macOS bundle present | Bundle selected and checked |
| Neither present | Advisory explicitly says version unverified |
| Selected version 3000.3.21 | Hard failure and upgrade guidance |
| Selected version 3000.3.22 | Version check passes |
| Selected newer valid version | Version check passes |
| Version command exits nonzero | Failure, not absent-binary advisory |
| Malformed or empty version output | Failure, not verified support |
| Non-macOS without PATH binary | No assumed macOS bundle support; advisory |
| Candidate path contains spaces | Correct invocation and parsing |
| Old PATH binary, newer bundle | Old selected binary fails; no silent masking |

Assert actual result status and useful diagnostic text rather than merely the word “version.”

### T10 — Onboarding size and content

**Procedure:** Render every harness onboarding file; measure UTF-8 bytes against the approved project-owned limit (proposed ≤12 KiB). Assert startup/resumption, approval, artifact-location, and untrusted-document guidance remains; check duplicate DocumentKB content is removed and links resolve inside a copied installation.

**Expected:** All outputs meet the agreed budget; critical instructions occur early; no unresolved template tokens; on-demand resources ship. Byte-count success is not universal proof against live truncation.

### T11 — Documentation and artifact hygiene

**Procedure:** Compare guide statements with emitted settings and doctor output. Search docs/README for stale versions, moved evidence paths, usage-hook claims, unsupported key enforcement claims, commands, and flags. Validate links after approved moves.

**Expected:** Documentation accurately distinguishes verified behavior and limitations; evidence remains accessible; no unrelated or unapproved deletion occurred. Tests assert concrete contracts rather than keyword counts.

### T12 — Retained merged features and cross-harness behavior

**Procedure:** Locate, record, and run existing compiled-runtime/release and `.devin` fallback tests. Exercise absent/unreadable harness metadata according to the supported fallback contract. Run the full deterministic suite and applicable plugin composition tests.

**Expected:** Merged Devin features survive; no unintended Claude resolution; other harnesses retain their contracts. A review comment reporting a merge is not adequate proof of functionality.

## 14. Live acceptance specifications

Use the isolated environments from section 8. Record exact CLI/Desktop build, tested commit, trust setup, commands/prompts, tool results, audit evidence, and before/after hashes. Preserve failed attempts. Setup failures are BLOCKED; ambiguous observations are not passes.

### L01 — Blocking and approval recovery

1. Start a supported CLI in a trusted fixture with plan approval pending.
2. Attempt a harmless protected sentinel edit; verify the hook rejects the actual call, exposes a useful reason, and leaves bytes unchanged.
3. Complete native human approval, repeat the same eligible operation, and verify success.
4. Exercise an out-of-scope reviewer read and a frozen-deliverable write, each with an allowed control after legitimate scope/receipt changes.

**Pass:** The harness enforces refusal and permits legitimate recovery. A model voluntarily avoiding the tool is inconclusive; use a controlled invocation or repeatable fixture driver rather than claiming a block. No synthetic human approval in this live test.

### L02 — Runner invocation boundaries

1. Start with an ordinary coding prompt that does not explicitly invoke an AIDLC runner.
2. Inspect exposed invocation metadata and actual tool traces.
3. Attempt model-initiated invocation of a user-only runner through a controlled harness driver where available.
4. Explicitly invoke the runner as the user in a fresh fixture.

**Pass:** The supported trigger policy makes model initiation unavailable/refused while explicit user invocation works and records only intended workflow boundaries. Observing a model that happened not to select a runner is insufficient by itself.

### L03 — Native persona restrictions

1. Dispatch a representative restricted persona through the orchestrator.
2. Inspect tool availability or attempt delegation in a controlled fixture.
3. Verify the persona can still perform a legitimate role task.

**Pass:** Native tool policy withholds/refuses delegation without breaking role capabilities; prompt compliance alone does not prove enforcement.

### L04 — Dispatch and audit uniqueness

1. Perform one eligible edit and one subagent run, followed by repeated polls.
2. Inspect actual hook dispatch and resulting events; compare event identity/type, not total ledger line counts.
3. Confirm no usage-fold subprocess launches.

**Pass:** Each expected logical event occurs once; polls add no completion events; required audit and sensor behavior remains.

### L05 — Claude/Devin coexistence

1. Capture a known event in a Devin-only fixture.
2. Install both harness surfaces in an isolated fixture with default compatibility imports and characterize duplicate registration/execution.
3. Apply the implemented and documented method of selecting one AIDLC hook source.
4. Fully restart; repeat the event and a guard-denial control in a fresh fixture.

**Pass:** The documented configuration emits one logical audit event while preserving enforcement. Default mixed-install behavior is accurately described. Do not demand default deduplication unless the implementation explicitly adds that guarantee. Leave real user configuration untouched.

### L06 — Real Desktop bundle discovery

1. On macOS with Desktop installed, remove standalone Devin only from the fixture process PATH.
2. Run doctor and record selected binary and version.
3. Compare with that bundled binary's own version output.

**Pass:** Doctor discovers and evaluates the actual off-PATH bundle. This is not evidence that Desktop executes hooks.

### L07 — Actual Desktop hook execution

1. Open the trusted fixture in Desktop's actual agent interface.
2. Trigger a benign event and verify that its hook executed.
3. Repeat L01's denied edit and human-approval recovery through Desktop itself.

**Pass:** Desktop executes hooks, enforces blocking, and permits legitimate recovery. Running the bundle in a terminal is not a substitute. Unavailable/inconclusive execution leaves Desktop runtime support unverified.

### L08 — Always-on content retention

Test three isolated rule contexts: clean global context; substantial representative global rules with measured byte counts; and an intentionally oversized positive control.

1. Place unique harmless sentinels near the beginning and end of the fixture onboarding content.
2. Start a fresh session and inspect injected context using supported diagnostics if available.
3. Otherwise ask for exact sentinel recall before allowing file reads, and inspect traces to ensure the model did not read the source file to answer.
4. Check the exact marker `Rule content truncated`, not the generic word “truncated.” Do not rely on `devin rules show`, which may expose the raw display path rather than injection.
5. Verify the on-demand reference can subsequently be read from the copied distribution.

**Pass:** Normal tested contexts retain both sentinels and required instructions; links work; the positive control establishes sensitivity of the measurement. Record limitations and repeat model-only observations rather than treating them as definitive introspection.

Do not infer a shared-budget implementation from these tests alone. Report tested byte counts and limitations; arbitrary user rules can exceed any practical headroom.

## 15. Regression sensitivity, evidence, and final exit criteria

### Prove tests detect their target defects

Retain implementation-time red/green evidence. If missing, restore only the relevant old behavior in a disposable fixture/worktree and confirm the targeted assertion fails; do not revert the working branch or rewrite history.

At minimum test sensitivity to:

- Reintroducing either usage-fold registration.
- Removing the inner subagent logging guard.
- Removing user-only runner triggers.
- Removing persona delegation restrictions.
- Restoring the old doctor missing-binary behavior or floor.
- Reintroducing oversized onboarding or removing an essential instruction.

A test that passes with its target defect restored must be strengthened. Keep sensitivity experiments isolated from normal acceptance artifacts and restore only test-owned temporary changes.

### Evidence record

Store results in engine-resolved artifacts or an agreed evidence location and link the final report from the PR. Each T/L case must have:

| Field | Required content |
|---|---|
| ID and coverage | T01–T12 or L01–L08; requirement and unit |
| Revision/environment | Tested commit, upstream baseline, OS and tool versions |
| Method | Actual test filename/command or repeatable live steps |
| Result | Expected assertion and observed outcome |
| Status | PASS, FAIL, BLOCKED, or NOT RUN |
| Proof | Redacted logs, dispatch trace, hashes, audit extracts, screenshots as applicable |
| Follow-up | Defect or limitation, owner, and human disposition where required |

Record command exit codes and preserve failed runs. Never classify BLOCKED/NOT RUN as passed. Reproduce suspected pre-existing failures on the selected upstream baseline in an isolated environment before labeling them unrelated. Do not modify global Git/LFS configuration or project security controls to force a baseline through.

### Implementation acceptance

- All deterministic cases and cross-harness checks pass, or specific baseline exceptions carry evidence and explicit maintainer acceptance; exceptions are not passes.
- Initial committed-output parity and post-regeneration reproducibility pass.
- Tests demonstrate sensitivity to the defects they claim to prevent.
- No new untriaged failures, unintended file changes, unsupported generated configuration, or unapproved deletions remain.
- Version metadata, documentation, and generated output agree with implementation.

### Runtime support acceptance

- Live CLI blocking/recovery, runner/persona policy, audit behavior, and onboarding injection have direct evidence.
- Coexistence guidance is verified in isolation.
- Desktop runtime support is claimed only when both L06 and L07 pass.
- Untested minimum-version and platform behavior is explicitly recorded, not inferred from stubs or another platform.
- A required blocked live test leaves its capability unverified and cannot be hidden behind a successful deterministic suite.

### Delivery completion

Every non-retracted finding has a verified fix or an explicit human-accepted limitation/deferment, each linked to evidence. Required workflow outputs and approvals are real, publication is authorized, and no support claim exceeds measured behavior. If these conditions are not met, report the precise remaining work and stop or park at a valid engine boundary rather than declaring completion.

// The cockpit plugin's own content validation + a live server smoke test.
//
// Distinct from the framework compose guard: this checks the plugin's authored
// content before packaging, then boots cockpit-serve.ts against a scratch
// project fixture and exercises the HTTP surface (no ACP agent needed).
//
// Run: bun test plugins/cockpit/tests/plugin.test.ts

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginContent } from "../../../tests/harness/plugin-kit.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..");
const SERVE = join(PLUGIN_ROOT, "tools", "cockpit-serve.ts");

describe("cockpit plugin own content validation", () => {
  test("passes the reusable plugin content validator", () => {
    expect(validatePluginContent(PLUGIN_ROOT)).toEqual([]);
  });

  test("ships the launch stage and the serve/doctor tools", () => {
    expect(existsSync(join(PLUGIN_ROOT, "stages", "ideation", "cockpit-launch.md"))).toBe(true);
    expect(existsSync(SERVE)).toBe(true);
    expect(existsSync(join(PLUGIN_ROOT, "tools", "cockpit-doctor.ts"))).toBe(true);
  });
});

describe("cockpit-serve workbench", () => {
  let tmp = "";
  let project = "";
  let server: ChildProcess | null = null;
  let base = "";
  let stderrLog = "";

  const AUDIT = `# AI-DLC Audit Log

## Workflow Start
**Timestamp**: 2026-01-01T00:00:00Z
**Event**: WORKFLOW_STARTED
**Scope**: feature
**Request**: build the widget

---

## Stage Start
**Timestamp**: 2026-01-01T00:00:10Z
**Event**: STAGE_STARTED
**Stage**: intent-capture
**Agent**: aidlc-product-agent

---

## Stage Awaiting Approval
**Timestamp**: 2026-01-01T00:01:00Z
**Event**: STAGE_AWAITING_APPROVAL
**Stage**: intent-capture

---

## Unit Started
**Timestamp**: 2026-01-01T00:02:00Z
**Event**: UNIT_STARTED
**Unit**: widget-core
**Stage**: build-and-test

---
`;

  const STATE_MD = `# AI-DLC State Tracking

## Project Information
- **Project**: build the widget
- **Project Type**: Greenfield
- **Scope**: feature
- **Current Stage**: intent-capture

## Phase Progress

- **Initialization**: Verified
- **Ideation**: Active
- **Inception**: Pending
- **Construction**: Pending
- **Operation**: Pending

## Stage Progress

### IDEATION PHASE
- [?] intent-capture — EXECUTE
- [ ] market-research — EXECUTE
- [ ] feasibility — SKIP
`;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "cockpit-test-"));
    project = join(tmp, "project");
    // Minimal composed-harness + aidlc workspace fixture.
    const dataDir = join(project, ".devin", "tools", "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "harness.json"),
      JSON.stringify({ harnessDir: ".devin", name: "devin", schemaVersion: 1, distribution: "devin" }),
    );
    writeFileSync(
      join(dataDir, "stage-graph.json"),
      JSON.stringify([
        { slug: "intent-capture", number: "1.1", name: "Intent Capture", phase: "ideation", execution: "ALWAYS", lead_agent: "aidlc-product-agent", support_agents: [], mode: "inline" },
        { slug: "market-research", number: "1.2", name: "Market Research", phase: "ideation", execution: "CONDITIONAL", lead_agent: "aidlc-product-agent", support_agents: [], mode: "inline" },
        { slug: "build-and-test", number: "3.6", name: "Build & Test", phase: "construction", execution: "ALWAYS", lead_agent: "aidlc-developer-agent", support_agents: [], mode: "inline" },
      ]),
    );
    const record = join(project, "aidlc", "spaces", "default", "intents", "widget-deadbeef");
    mkdirSync(join(record, "audit", "clone-1"), { recursive: true });
    mkdirSync(join(record, "ideation", "intent-capture"), { recursive: true });
    writeFileSync(join(project, "aidlc", "active-space"), "default");
    writeFileSync(join(record, "aidlc-state.md"), STATE_MD);
    writeFileSync(join(record, "audit", "clone-1", "a1b2c3d4e5f6.md"), AUDIT);
    writeFileSync(join(record, "ideation", "intent-capture", "intent-statement.md"), "# Intent\n\nBuild the widget.\n");

    server = spawn(process.execPath, [SERVE, "serve", "--port", "0", "--project-dir", project, "--no-agent"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (d: Buffer) => {
      const m = d.toString().match(/COCKPIT_LISTEN (http:\/\/\S+)/);
      if (m) base = m[1];
    });
    server.stderr?.on("data", (d: Buffer) => {
      stderrLog += d.toString();
    });
    const deadline = Date.now() + 20_000;
    while (!base && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (!base) throw new Error(`server did not listen; stderr=${stderrLog}`);
  }, 30_000);

  afterAll(() => {
    if (server) server.kill();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("GET / serves the workbench page", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AIDLC");
  });

  test("GET /api/state renders intent, stages, units, gates", async () => {
    const res = await fetch(`${base}/api/state`);
    const snap = (await res.json()) as {
      space: string;
      scope: string;
      stages: { slug: string; status: string }[];
      units: { slug: string; status: string }[];
      gates: string[];
      artifacts: { name: string }[];
      intents: { slug: string; active: boolean }[];
    };
    expect(snap.space).toBe("default");
    expect(snap.scope).toBe("feature");
    const bySlug = Object.fromEntries(snap.stages.map((s) => [s.slug, s.status]));
    expect(bySlug["intent-capture"]).toBe("awaiting");
    expect(bySlug["market-research"]).toBe("pending");
    expect(bySlug["build-and-test"]).toBe("pending");
    expect(snap.gates).toContain("intent-capture");
    expect(snap.units.some((u) => u.slug === "widget-core" && u.status === "running")).toBe(true);
    expect(snap.artifacts.some((a) => a.name === "intent-statement.md")).toBe(true);
    expect(snap.intents[0]?.active).toBe(true);
  });

  test("GET /api/file confines reads to the project dir", async () => {
    const ok = await fetch(`${base}/api/file?p=${encodeURIComponent("aidlc/spaces/default/intents/widget-deadbeef/ideation/intent-capture/intent-statement.md")}`);
    expect((await ok.json()).content).toContain("Build the widget");
    const bad = await fetch(`${base}/api/file?p=${encodeURIComponent("../../etc/passwd")}`);
    expect(bad.status).toBe(403);
  });

  test("POST /api/shutdown stops the server", async () => {
    const res = await fetch(`${base}/api/shutdown`, { method: "POST" });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const probe = await fetch(`${base}/api/meta`).catch(() => null);
    expect(probe).toBeNull();
  });
});

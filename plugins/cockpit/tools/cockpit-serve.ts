#!/usr/bin/env bun
// cockpit-serve.ts — the cockpit plugin's localhost workbench.
//
// A single-file Bun server that renders a live, v2-style AI-DLC interface:
// the intent's stage pipeline, parallel unit lanes, human gates, produced
// artifacts, the audit feed, and token/cost usage — read straight from the
// project's on-disk engine state (aidlc/ record + <harness>/tools/data).
//
// It is also an ACP client: it spawns the harness's agent (default
// `devin acp`, override with --agent or COCKPIT_AGENT) and speaks JSON-RPC
// over stdio, so the browser can prompt the agent, stream its turns, and
// answer its permission requests — the same contract Zed/JetBrains use.
//
// Commands:
//   serve   [--port N] [--host H] [--project-dir D] [--agent "cmd args"] [--no-agent]
//   ensure  [...]     start a detached server if the port is not already serving; print JSON
//   stop    [--port N] stop a running server
//   status  [--port N] probe and print JSON
//
// The tool is intentionally self-contained (no imports from the engine) so it
// composes into any harness tools dir unchanged. It uses only node: APIs, so
// it runs under bun (the harness convention) or any runtime that strips types.

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = "cockpit";
const VERSION = "0.1.0";
const DEFAULT_PORT = 4780;
const DEFAULT_AGENT = process.env.COCKPIT_AGENT?.trim() || "devin acp";
const TOOL_PATH = fileURLToPath(import.meta.url);
const TOOLS_DIR = dirname(TOOL_PATH);

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
type Cli = {
  cmd: string;
  port: number;
  host: string;
  projectDir: string;
  agent: string[];
  noAgent: boolean;
  open: boolean;
};

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    cmd: "serve",
    port: Number(process.env.COCKPIT_PORT ?? DEFAULT_PORT),
    host: process.env.COCKPIT_HOST ?? "127.0.0.1",
    projectDir:
      process.env.AIDLC_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    agent: splitCommand(process.env.COCKPIT_AGENT?.trim() || DEFAULT_AGENT),
    noAgent: false,
    open: false,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    const first = args.shift();
    if (first) cli.cmd = first;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === "--port") cli.port = Number(next());
    else if (a === "--host") cli.host = next();
    else if (a === "--project-dir") cli.projectDir = next();
    else if (a === "--agent") cli.agent = splitCommand(next());
    else if (a === "--no-agent") cli.noAgent = true;
    else if (a === "--open") cli.open = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (!Number.isFinite(cli.port) || cli.port < 0 || cli.port > 65535) {
    console.error(`invalid --port ${cli.port}`);
    process.exit(2);
  }
  cli.projectDir = resolve(cli.projectDir);
  return cli;
}

function splitCommand(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (;;) {
    const m = re.exec(s);
    if (m === null) break;
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

function printHelp(): void {
  console.log(`cockpit-serve — localhost AI-DLC workbench + ACP bridge

Usage: bun cockpit-serve.ts [command] [flags]

Commands:
  serve    run the workbench in the foreground (default)
  ensure   start a detached server if one is not already serving the port
  stop     stop the server bound to --port
  status   probe the port and print one JSON status line

Flags:
  --port N         listen port (default ${DEFAULT_PORT}, env COCKPIT_PORT; 0 = ephemeral)
  --host H         bind host (default 127.0.0.1, env COCKPIT_HOST)
  --project-dir D  AIDLC project root (default: cwd / AIDLC_PROJECT_DIR)
  --agent "cmd"    ACP agent command (default "${DEFAULT_AGENT}", env COCKPIT_AGENT)
  --no-agent       run UI-only; never spawn the ACP agent
  --open           open the workbench in a browser once listening
`);
}

// --------------------------------------------------------------------------
// AIDLC state readers — read-only views over the on-disk engine state.
// --------------------------------------------------------------------------
type Json = Record<string, unknown>;

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readJson(path: string): unknown {
  const raw = readText(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const HARNESS_CANDIDATES = [".devin", ".claude", ".kiro", ".codex", ".cursor", ".aidlc"];

function detectHarnessDir(projectDir: string): string {
  const explicit = process.env.AIDLC_HARNESS_DIR?.trim();
  if (explicit) return explicit;
  // When composed, this file lives at <project>/<harness>/tools/cockpit-serve.ts.
  const parent = basename(dirname(TOOLS_DIR));
  if (/^\.[a-z0-9][a-z0-9._-]*$/i.test(parent)) return parent;
  for (const d of HARNESS_CANDIDATES) {
    if (existsSync(join(projectDir, d, "tools", "data", "harness.json"))) return d;
  }
  return ".devin";
}

interface AuditEvent {
  heading: string;
  event: string;
  ts: string;
  fields: Record<string, string>;
}

function parseAuditBlocks(text: string): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (const block of text.split(/\n?---\n/)) {
    const heading = block.match(/^##\s+(.+)$/m)?.[1]?.trim();
    if (!heading) continue;
    const fields: Record<string, string> = {};
    for (const m of block.matchAll(/^\*\*([A-Za-z][A-Za-z0-9 ._()/-]*)\*\*:[ \t](.*)$/gm)) {
      fields[m[1]] = m[2].replace(/\\n/g, "\n");
    }
    out.push({
      heading,
      event: fields.Event ?? heading,
      ts: fields.Timestamp ?? "",
      fields,
    });
  }
  return out;
}

function auditEventsFor(recordDir: string | null, spaceRoot: string | null): AuditEvent[] {
  const events: AuditEvent[] = [];
  const dirs = [recordDir ? join(recordDir, "audit") : null, spaceRoot ? join(spaceRoot, "audit") : null];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const shard of listDirs(dir)) {
      for (const f of listFiles(join(dir, shard))) {
        if (!f.endsWith(".md")) continue;
        const text = readText(join(dir, shard, f));
        if (text) events.push(...parseAuditBlocks(text));
      }
    }
    // audit shards may also sit directly under audit/ (flat fixture layout)
    for (const f of listFiles(dir)) {
      if (!f.endsWith(".md")) continue;
      const text = readText(join(dir, f));
      if (text) events.push(...parseAuditBlocks(text));
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return events;
}

// aidlc-state.md: parse the **Key**: scalar fields and the stage checkbox rows.
function parseStateFile(text: string): {
  fields: Record<string, string>;
  stages: Record<string, { mark: string; scope: string }>;
  phases: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  const stages: Record<string, { mark: string; scope: string }> = {};
  const phases: Record<string, string> = {};
  for (const m of text.matchAll(/^\s*-?\s*\*\*([A-Za-z][A-Za-z0-9 ._()/-]*)\*\*:\s*(.*)$/gm)) {
    fields[m[1].trim()] = m[2].trim();
  }
  for (const m of text.matchAll(/^- \[([ x?RS-])\]\s+([a-z][a-z0-9-]*)\s*—\s*(EXECUTE|SKIP)\s*$/gm)) {
    stages[m[2]] = { mark: m[1], scope: m[3] };
  }
  for (const m of text.matchAll(/^- \*\*([A-Za-z]+)\*\*:\s*(Pending|Active|Verified|Skipped)\s*$/gm)) {
    phases[m[1].toLowerCase()] = m[2];
  }
  return { fields, stages, phases };
}

const STAGE_STATUS_FROM_EVENT: Record<string, string> = {
  STAGE_STARTED: "running",
  STAGE_AWAITING_APPROVAL: "awaiting",
  STAGE_REVISING: "revising",
  GATE_REJECTED: "rejected",
  STAGE_COMPLETED: "completed",
  STAGE_SKIPPED: "skipped",
};
const MARK_STATUS: Record<string, string> = {
  "x": "completed",
  "-": "running",
  "?": "awaiting",
  "R": "revising",
  "S": "skipped",
};

function walkFiles(dir: string, depth = 6): string[] {
  if (depth < 0) return [];
  const out: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, depth - 1));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function buildSnapshot(projectDir: string, harnessDir: string): Json {
  const aidlc = join(projectDir, "aidlc");
  const space = readText(join(aidlc, "active-space"))?.trim() || "default";
  const spaceRoot = join(aidlc, "spaces", space);
  const intentsRoot = join(spaceRoot, "intents");
  const registryRaw = readJson(join(intentsRoot, "intents.json"));
  const registry = Array.isArray(registryRaw) ? (registryRaw as Json[]) : [];
  const recordDirs = listDirs(intentsRoot).filter((d) =>
    existsSync(join(intentsRoot, d, "aidlc-state.md"))
  );
  const activeCursor = readText(join(intentsRoot, "active-intent"))?.trim() ?? "";
  const activeDirName =
    (activeCursor && recordDirs.includes(activeCursor) && activeCursor) ||
    (recordDirs.length === 1 ? recordDirs[0] : "") ||
    recordDirs.find((d) =>
      registry.some((r) => r.dirName === d || d.startsWith(`${r.slug}-`)),
    ) ||
    "";
  const recordDir = activeDirName ? join(intentsRoot, activeDirName) : null;

  const stateText = recordDir ? readText(join(recordDir, "aidlc-state.md")) : null;
  const state = stateText ? parseStateFile(stateText) : { fields: {}, stages: {}, phases: {} };

  const graphRaw = readJson(join(projectDir, harnessDir, "tools", "data", "stage-graph.json"));
  const graph: Json[] = Array.isArray(graphRaw)
    ? (graphRaw as Json[])
    : Array.isArray((graphRaw as Json | null)?.stages)
      ? ((graphRaw as Json).stages as Json[])
      : [];

  const scope = state.fields.Scope || "";
  const events = auditEventsFor(recordDir, existsSync(spaceRoot) ? intentsRoot : null);

  // Per-stage live status: audit events give transitions, the state file's
  // checkboxes are the durable truth for completion.
  const auditStatus: Record<string, { status: string; ts: string; event: string }> = {};
  for (const e of events) {
    const slug = e.fields.Stage;
    const mapped = STAGE_STATUS_FROM_EVENT[e.event];
    if (slug && mapped) auditStatus[slug] = { status: mapped, ts: e.ts, event: e.event };
    // GATE_APPROVED is emitted per-stage too.
    if (slug && e.event === "GATE_APPROVED")
      auditStatus[slug] = { status: "completed", ts: e.ts, event: e.event };
  }

  const stages = graph.map((s) => {
    const slug = String(s.slug ?? "");
    const box = state.stages[slug];
    let status: string;
    if (box?.scope === "SKIP") status = "skipped";
    else if (box?.mark === "x" || box?.mark === "S") status = "completed";
    else if (auditStatus[slug]) status = auditStatus[slug].status;
    else if (box && MARK_STATUS[box.mark]) status = MARK_STATUS[box.mark];
    else status = "pending";
    return {
      slug,
      number: s.number ?? "",
      name: s.name ?? slug,
      phase: s.phase ?? "",
      agent: s.lead_agent ?? "",
      plugin: s.plugin ?? null,
      execution: s.execution ?? "",
      status,
      lastEvent: auditStatus[slug] ?? null,
    };
  });

  // Parallel unit lanes from UNIT_*/SWARM_* audit events (the v2 construction model).
  const units: Record<string, Json> = {};
  for (const e of events) {
    const unit = e.fields.Unit ?? e.fields["Unit slug"];
    if (!unit) continue;
    let lane = units[unit];
    if (!lane) {
      lane = { slug: unit, status: "pending", stage: "", ts: "", events: 0 };
      units[unit] = lane;
    }
    lane.events = (lane.events as number) + 1;
    lane.ts = e.ts;
    if (e.fields.Stage) lane.stage = e.fields.Stage;
    if (e.event === "UNIT_STARTED" || e.event === "UNIT_RESUMED") lane.status = "running";
    else if (e.event === "UNIT_PAUSED") lane.status = "paused";
    else if (e.event === "UNIT_COMPLETED" || e.event === "SWARM_UNIT_CONVERGED") lane.status = "completed";
    else if (e.event === "UNIT_MERGED" || e.event === "SWARM_SOURCE_MERGED") lane.status = "merged";
    else if (e.event === "UNIT_FAILED" || e.event === "SWARM_UNIT_FAILED") lane.status = "failed";
  }

  // Artifacts: files under <record>/<phase>/<stage>/ (plus loose record files).
  const artifacts: Json[] = [];
  if (recordDir) {
    for (const file of walkFiles(recordDir)) {
      const rel = file.slice(recordDir.length + 1);
      if (rel.startsWith(`audit${sep}`)) continue;
      const parts = rel.split(sep);
      const st = statSync(file);
      artifacts.push({
        path: rel.split(sep).join("/"),
        phase: parts.length > 2 ? parts[0] : "",
        stage: parts.length > 2 ? parts[1] : "",
        name: parts[parts.length - 1],
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
    }
  }

  const usageRaw = readJson(join(aidlc, ".aidlc-sessions", "usage-ledger.json")) as Json | null;
  const usage = usageRaw
    ? {
        totals: usageRaw.totals ?? null,
        byStage: (usageRaw.byStage as Json | undefined) ?? {},
        byModel: (usageRaw.byModel as Json | undefined) ?? {},
        schemaVersion: usageRaw.schemaVersion ?? null,
      }
    : null;

  const intents = recordDirs.map((d) => {
    const row = registry.find((r) => r.dirName === d || d.startsWith(`${r.slug}-`));
    const st = readText(join(intentsRoot, d, "aidlc-state.md"));
    const parsed = st ? parseStateFile(st) : null;
    return {
      dirName: d,
      slug: (row?.slug as string) ?? d,
      scope: (row?.scope as string) ?? parsed?.fields.Scope ?? "",
      status: (row?.status as string) ?? "",
      project: parsed?.fields.Project ?? "",
      currentStage: parsed?.fields["Current Stage"] ?? "",
      active: d === activeDirName,
    };
  });

  const gates = stages
    .filter((s) => s.status === "awaiting" || s.status === "revising")
    .map((s) => s.slug);

  return {
    generatedAt: new Date().toISOString(),
    projectDir,
    harnessDir,
    space,
    scope,
    recordDir,
    intents,
    state: {
      fields: state.fields,
      phases: state.phases,
      checkboxes: state.stages,
    },
    stages,
    units: Object.values(units),
    gates,
    artifacts,
    events: events.slice(-400),
    usage,
  };
}

// --------------------------------------------------------------------------
// ACP bridge — newline-delimited JSON-RPC over the agent's stdio.
// --------------------------------------------------------------------------
type PendingReq = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  method: string;
};

class AcpBridge {
  cmd: string[];
  cwd: string;
  projectDir: string;
  proc: ChildProcess | null = null;
  nextId = 1;
  pending = new Map<number | string, PendingReq>();
  permissions = new Map<string, { respond: (outcome: unknown) => void; info: Json }>();
  sessionId: string | null = null;
  status = "off"; // off | starting | connected | auth-required | error | exited
  agentInfo: Json | null = null;
  agentCapabilities: Json | null = null;
  authMethods: Json[] = [];
  modes: Json | null = null;
  lastError = "";
  stderrTail: string[] = [];
  onEvent: (kind: string, data: unknown) => void = () => {};
  private lineBuf = "";
  private stopping = false;

  constructor(cmd: string[], cwd: string, projectDir: string) {
    this.cmd = cmd;
    this.cwd = cwd;
    this.projectDir = projectDir;
  }

  describe(): Json {
    return {
      cmd: this.cmd.join(" "),
      status: this.status,
      sessionId: this.sessionId,
      agentInfo: this.agentInfo,
      authMethods: this.authMethods,
      modes: this.modes,
      lastError: this.lastError,
      stderrTail: this.stderrTail.slice(-12),
      pendingPermissions: [...this.permissions.values()].map((p) => p.info),
    };
  }

  start(): void {
    if (this.proc) return;
    this.status = "starting";
    this.emit("status", this.describe());
    try {
      this.proc = spawn(this.cmd[0], this.cmd.slice(1), {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (e) {
      this.fail(`spawn failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const proc = this.proc;
    proc.stdout?.on("data", (d: Buffer) => this.onData(d.toString("utf-8")));
    proc.stderr?.on("data", (d: Buffer) => {
      for (const line of d.toString("utf-8").split("\n")) {
        if (line.trim()) this.stderrTail.push(line.trim().slice(0, 400));
      }
      if (this.stderrTail.length > 60) this.stderrTail.splice(0, this.stderrTail.length - 60);
    });
    proc.on("error", (e: Error) => this.fail(`spawn error: ${e.message}`));
    proc.on("exit", (code: number | null, signal: string | null) => {
      this.proc = null;
      this.sessionId = null;
      this.rejectAll(new Error(`agent exited (code ${code} signal ${signal})`));
      if (!this.stopping) {
        this.status = "exited";
        this.emit("status", this.describe());
      }
    });
    this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
      clientInfo: { name: "aidlc-cockpit", version: VERSION },
    })
      .then((res) => {
        const r = (res ?? {}) as Json;
        this.agentInfo = (r.agentInfo as Json) ?? null;
        this.agentCapabilities = (r.agentCapabilities as Json) ?? null;
        this.authMethods = (r.authMethods as Json[]) ?? [];
        this.status = "connected";
        this.emit("status", this.describe());
        return this.newSession();
      })
      .catch((e) => this.fail(`initialize failed: ${e.message}`));
  }

  private fail(msg: string): void {
    this.lastError = msg;
    this.status = "error";
    this.emit("status", this.describe());
  }

  private rejectAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
    for (const [, perm] of this.permissions) {
      try {
        perm.respond({ outcome: { outcome: "cancelled" } });
      } catch {}
    }
    this.permissions.clear();
  }

  stop(): void {
    this.stopping = true;
    this.rejectAll(new Error("agent stopped"));
    try {
      this.proc?.kill();
    } catch {}
    this.proc = null;
    this.sessionId = null;
    this.status = "off";
    this.emit("status", this.describe());
  }

  private send(msg: Json): void {
    const stdin = this.proc?.stdin;
    if (!stdin) throw new Error("agent not running");
    stdin.write(`${JSON.stringify(msg)}\n`);
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, method });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        rejectPromise(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private respond(id: number | string, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: number | string, code: number, message: string): void {
    this.send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private onData(chunk: string): void {
    this.lineBuf += chunk;
    for (;;) {
      const idx = this.lineBuf.indexOf("\n");
      if (idx < 0) break;
      const line = this.lineBuf.slice(0, idx).trim();
      this.lineBuf = this.lineBuf.slice(idx + 1);
      if (!line) continue;
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        this.emit("agent-stderr", `unparseable agent line: ${line.slice(0, 300)}`);
        continue;
      }
      this.onMessage(msg);
    }
  }

  private onMessage(msg: Json): void {
    const hasId = msg.id !== undefined && msg.id !== null;
    const hasMethod = typeof msg.method === "string";
    if (hasId && !hasMethod) {
      const p = this.pending.get(msg.id as number | string);
      if (p) {
        this.pending.delete(msg.id as number | string);
        if (msg.error) {
          const err = msg.error as Json;
          p.reject(new Error(`${p.method}: ${String(err.message ?? err.code ?? "ACP error")}`));
        } else p.resolve(msg.result);
      }
      return;
    }
    if (hasId && hasMethod) {
      this.onAgentRequest(msg.id as number | string, msg.method as string, msg.params);
      return;
    }
    if (hasMethod) this.onAgentNotification(msg.method as string, msg.params);
  }

  private onAgentNotification(method: string, params: unknown): void {
    if (method === "session/update") {
      this.emit("update", params);
      return;
    }
    this.emit("notification", { method, params });
  }

  private onAgentRequest(id: number | string, method: string, params: unknown): void {
    const p = (params ?? {}) as Json;
    if (method === "fs/read_text_file") {
      const path = this.confine(String(p.path ?? ""));
      if (!path) {
        this.respondError(id, -32602, "path outside project");
        return;
      }
      const text = readText(path);
      if (text === null) {
        this.respondError(id, -32602, `cannot read ${p.path}`);
        return;
      }
      this.respond(id, { content: text });
      return;
    }
    if (method === "fs/write_text_file") {
      const path = this.confine(String(p.path ?? ""));
      if (!path) {
        this.respondError(id, -32602, "path outside project");
        return;
      }
      try {
        writeFileSync(path, String(p.content ?? ""));
        this.respond(id, {});
      } catch (e) {
        this.respondError(id, -32603, e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (method === "session/request_permission") {
      const key = `${p.sessionId ?? ""}:${String(id)}`;
      const options = Array.isArray(p.options) ? (p.options as Json[]) : [];
      const info: Json = {
        id: key,
        requestId: id,
        sessionId: p.sessionId ?? null,
        toolCall: p.toolCall ?? null,
        options,
        receivedAt: new Date().toISOString(),
      };
      this.permissions.set(key, {
        info,
        respond: (outcome) => {
          try {
            this.respond(id, { outcome });
          } catch {}
        },
      });
      this.emit("permission", info);
      return;
    }
    this.respondError(id, -32601, `method not supported: ${method}`);
  }

  resolvePermission(key: string, optionId: string | null): boolean {
    const perm = this.permissions.get(key);
    if (!perm) return false;
    this.permissions.delete(key);
    perm.respond(
      optionId === null
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId } },
    );
    this.emit("permission-resolved", { id: key, optionId });
    return true;
  }

  private confine(path: string): string | null {
    if (!path) return null;
    const abs = isAbsolute(path) ? resolve(path) : resolve(this.projectDir, path);
    return abs === this.projectDir || abs.startsWith(this.projectDir + sep) ? abs : null;
  }

  async newSession(): Promise<Json> {
    const res = (await this.request("session/new", {
      cwd: this.projectDir,
      mcpServers: [],
    })) as Json;
    this.sessionId = (res?.sessionId as string) ?? null;
    this.modes = (res?.modes as Json) ?? null;
    this.emit("session", this.describe());
    return res ?? {};
  }

  async prompt(text: string): Promise<unknown> {
    if (!this.sessionId) await this.newSession();
    if (!this.sessionId) throw new Error("no ACP session");
    this.emit("prompt-started", { text });
    try {
      const res = await this.request("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      });
      this.emit("prompt-done", res);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/auth/i.test(msg)) {
        this.status = "auth-required";
        this.emit("status", this.describe());
      }
      this.emit("prompt-error", { error: msg });
      throw e;
    }
  }

  cancel(): void {
    if (!this.sessionId) return;
    try {
      this.send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this.sessionId },
      });
    } catch {}
  }

  async authenticate(methodId: string): Promise<unknown> {
    const res = await this.request("authenticate", { methodId });
    this.status = "connected";
    this.emit("status", this.describe());
    return res;
  }

  async setMode(modeId: string): Promise<unknown> {
    if (!this.sessionId) return {};
    const res = await this.request("session/set_mode", {
      sessionId: this.sessionId,
      modeId,
    });
    this.emit("status", this.describe());
    return res;
  }

  private emit(kind: string, data: unknown): void {
    try {
      this.onEvent(kind, data);
    } catch {}
  }
}

// --------------------------------------------------------------------------
// Server (node:http — works under bun and modern node alike)
// --------------------------------------------------------------------------
type SseClient = { res: ServerResponse; push: (kind: string, data: unknown) => void };
const sseClients = new Set<SseClient>();

function sseBroadcast(kind: string, data: unknown): void {
  for (const c of sseClients) {
    try {
      c.push(kind, data);
    } catch {}
  }
}

function jsonRes(res: ServerResponse, body: unknown, status = 200): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > 4_000_000) {
        rejectPromise(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", rejectPromise);
  });
}

function startServer(cli: Cli): void {
  const projectDir = cli.projectDir;
  const harnessDir = detectHarnessDir(projectDir);

  const acp = new AcpBridge(cli.agent, projectDir, projectDir);
  acp.onEvent = (kind, data) => sseBroadcast(`acp-${kind}`, data);
  if (!cli.noAgent) acp.start();

  // Poll the engine state; push a fresh snapshot whenever it changes.
  let lastHash = "";
  const snapshot = () => {
    try {
      const snap = buildSnapshot(projectDir, harnessDir);
      const hash = createHash("sha1").update(JSON.stringify(snap)).digest("hex");
      return { snap, hash, changed: hash !== lastHash };
    } catch (e) {
      return {
        snap: { error: e instanceof Error ? e.message : String(e) } as Json,
        hash: "",
        changed: false,
      };
    }
  };
  const poller = setInterval(() => {
    const { snap, hash, changed } = snapshot();
    if (changed) {
      lastHash = hash;
      sseBroadcast("state", snap);
    }
  }, 1500);

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      try {
        jsonRes(res, { error: e instanceof Error ? e.message : String(e) }, 500);
      } catch {}
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${cli.host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && (path === "/" || path === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    if (method === "GET" && path === "/api/meta") {
      return jsonRes(res, {
        plugin: PLUGIN,
        version: VERSION,
        pid: process.pid,
        projectDir,
        harnessDir,
        url: `http://${cli.host}:${boundPort()}`,
        agent: acp.describe(),
      });
    }
    if (method === "GET" && path === "/api/state") return jsonRes(res, snapshot().snap);
    if (method === "GET" && path === "/api/file") {
      const rel = url.searchParams.get("p") ?? "";
      const abs = resolve(projectDir, rel);
      if (abs !== projectDir && !abs.startsWith(projectDir + sep)) {
        return jsonRes(res, { error: "path outside project" }, 403);
      }
      const text = readText(abs);
      if (text === null) return jsonRes(res, { error: "not found" }, 404);
      if (text.length > 2_000_000) return jsonRes(res, { error: "file too large" }, 413);
      return jsonRes(res, { path: rel, content: text });
    }
    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`: cockpit\n\n`);
      const client: SseClient = {
        res,
        push: (kind, data) => res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`),
      };
      sseClients.add(client);
      client.push("state", snapshot().snap);
      client.push("acp-status", acp.describe());
      req.on("close", () => sseClients.delete(client));
      return;
    }
    if (method === "POST" && path === "/api/agent/prompt") {
      const body = JSON.parse((await readBody(req)) || "{}") as Json;
      const text = String(body.text ?? "");
      if (!text.trim()) return jsonRes(res, { error: "empty prompt" }, 400);
      // Reply immediately; the turn streams back over SSE.
      acp.prompt(text).catch(() => {});
      return jsonRes(res, { ok: true });
    }
    if (method === "POST" && path === "/api/agent/session") {
      if (!acp.proc) acp.start();
      const out = await acp.newSession().catch((e) => ({ error: String(e) }));
      return jsonRes(res, out);
    }
    if (method === "POST" && path === "/api/agent/cancel") {
      acp.cancel();
      return jsonRes(res, { ok: true });
    }
    if (method === "POST" && path === "/api/agent/stop") {
      acp.stop();
      return jsonRes(res, { ok: true });
    }
    if (method === "POST" && path === "/api/agent/permission") {
      const body = JSON.parse((await readBody(req)) || "{}") as Json;
      const id = String(body.id ?? "");
      const optionId =
        body.optionId === undefined || body.optionId === null ? null : String(body.optionId);
      return jsonRes(res, { ok: acp.resolvePermission(id, optionId) });
    }
    if (method === "POST" && path === "/api/agent/authenticate") {
      const body = JSON.parse((await readBody(req)) || "{}") as Json;
      const out = await acp.authenticate(String(body.methodId ?? "")).catch((e) => ({ error: String(e) }));
      return jsonRes(res, out);
    }
    if (method === "POST" && path === "/api/agent/mode") {
      const body = JSON.parse((await readBody(req)) || "{}") as Json;
      const out = await acp.setMode(String(body.modeId ?? "")).catch((e) => ({ error: String(e) }));
      return jsonRes(res, out);
    }
    if (method === "POST" && path === "/api/shutdown") {
      jsonRes(res, { ok: true });
      setTimeout(() => {
        clearInterval(poller);
        acp.stop();
        process.exit(0);
      }, 50);
      return;
    }
    return jsonRes(res, { error: "not found" }, 404);
  }

  const boundPort = () => {
    const a = server.address();
    return typeof a === "object" && a ? a.port : cli.port;
  };

  server.listen(cli.port, cli.host, () => {
    const url = `http://${cli.host}:${boundPort()}`;
    console.log(`COCKPIT_LISTEN ${url}`);
    console.log(
      `[cockpit] project=${projectDir} harness=${harnessDir} agent=${cli.noAgent ? "off" : cli.agent.join(" ")}`,
    );
    if (cli.open) openBrowser(url);
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {}
}

async function probe(port: number, host: string): Promise<Json | null> {
  try {
    const res = await fetch(`http://${host}:${port}/api/meta`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return (await res.json()) as Json;
  } catch {
    return null;
  }
}

async function ensure(cli: Cli): Promise<void> {
  const existing = await probe(cli.port, cli.host);
  if (existing) {
    console.log(JSON.stringify({ status: "already-running", url: existing.url, port: cli.port, pid: existing.pid }));
    return;
  }
  const args = [
    TOOL_PATH,
    "serve",
    "--port",
    String(cli.port),
    "--host",
    cli.host,
    "--project-dir",
    cli.projectDir,
  ];
  if (cli.noAgent) args.push("--no-agent");
  if (cli.agent.join(" ") !== DEFAULT_AGENT) args.push("--agent", cli.agent.join(" "));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const meta = await probe(cli.port, cli.host);
    if (meta) {
      console.log(
        JSON.stringify({ status: "started", url: meta.url, port: cli.port, pid: meta.pid }),
      );
      return;
    }
  }
  console.log(
    JSON.stringify({ status: "degraded", url: null, port: cli.port, pid: child.pid ?? null }),
  );
  process.exitCode = 1;
}

async function stop(cli: Cli): Promise<void> {
  const meta = await probe(cli.port, cli.host);
  if (!meta) {
    console.log(JSON.stringify({ status: "not-running", port: cli.port }));
    return;
  }
  await fetch(`http://${cli.host}:${cli.port}/api/shutdown`, { method: "POST" }).catch(() => {});
  console.log(JSON.stringify({ status: "stopped", port: cli.port, pid: meta.pid ?? null }));
}

// --------------------------------------------------------------------------
// The workbench page (embedded; no external assets — works fully offline).
// --------------------------------------------------------------------------
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI-DLC Cockpit</title>
<style>
:root{
  --bg:#0b0e14;--panel:#11151d;--panel2:#161b26;--line:#232a38;--text:#d7dee9;
  --dim:#7d8798;--acc:#4da3ff;--green:#3fb96f;--amber:#e0a33e;--red:#e05e5e;
  --purple:#a58cff;--chip:#1d2432;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:13px/1.5 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overflow:hidden}
code,pre,.mono{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#app{display:flex;flex-direction:column;height:100%}
header{display:flex;align-items:center;gap:14px;padding:8px 14px;background:var(--panel);border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap;row-gap:4px}
.logo{font-weight:700;font-size:15px;letter-spacing:.4px;color:var(--acc);white-space:nowrap;flex:none}
.logo small{color:var(--dim);font-weight:400}
.hdr-field{color:var(--dim);white-space:nowrap;min-width:0}
.hdr-field b{display:inline-block;max-width:180px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
.pill{padding:2px 9px;border-radius:20px;background:var(--chip);border:1px solid var(--line);color:var(--dim);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px;flex:none}
#b-session{flex:none;white-space:nowrap}
.pill.ok{color:var(--green);border-color:#2c4d3a}.pill.warn{color:var(--amber);border-color:#57431e}.pill.bad{color:var(--red);border-color:#573030}
.spacer{flex:1}
button{background:var(--chip);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
button:hover{border-color:var(--acc);color:var(--acc)}
button.primary{background:var(--acc);border-color:var(--acc);color:#06101f;font-weight:600}
button.primary:hover{color:#fff}
button:disabled{opacity:.45;cursor:default}
#cols{display:flex;flex:1;min-height:0}
#pipeline{width:300px;min-width:230px;background:var(--panel);border-right:1px solid var(--line);overflow-y:auto;flex:none}
#center{flex:1;display:flex;flex-direction:column;min-width:300px}
#inspector{width:360px;min-width:260px;background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;flex:none}
@media(max-width:1100px){#pipeline{width:190px;min-width:140px}#inspector{width:230px;min-width:180px}#center{min-width:280px}}
@media(max-width:760px){
  #cols{flex-direction:column;overflow-y:auto;padding-bottom:150px}
  #pipeline{width:auto;min-width:0;flex:none;max-height:38vh;border-right:0;border-bottom:1px solid var(--line)}
  #center{flex:none;min-width:0;min-height:0}
  #stream{flex:none;min-height:150px;max-height:50vh}
  #composer{position:fixed;left:0;right:0;bottom:0;z-index:6}
  #inspector{width:auto;min-width:0;flex:none;max-height:65vh;border-left:0;border-top:1px solid var(--line)}
  header{gap:8px 10px;padding:6px 10px}
  .pill{max-width:46vw}
}
.phase{border-bottom:1px solid var(--line)}
.phase-h{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
.phase-h:hover{color:var(--text)}
.phase-h .cnt{margin-left:auto;font-weight:400;color:var(--dim)}
.stg{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 22px;cursor:pointer}
.stg:hover{background:var(--panel2)}
.stg.sel{background:var(--panel2);box-shadow:inset 2px 0 0 var(--acc)}
.stg .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stg .num{color:var(--dim);font-size:11px;min-width:26px}
.stg .ag{margin-left:auto;color:var(--dim);font-size:10px}
.dot{width:9px;height:9px;border-radius:50%;background:#3a4356;flex:none}
.dot.pending{background:#3a4356}.dot.running{background:var(--acc);animation:pl 1.2s infinite}
.dot.awaiting{background:var(--amber);animation:pl 1.2s infinite}.dot.completed{background:var(--green)}
.dot.revising{background:var(--purple)}.dot.rejected{background:var(--red)}
.dot.failed{background:var(--red)}.dot.skipped{background:#2a3040}
@keyframes pl{50%{opacity:.35}}
.unit-row{display:flex;align-items:center;gap:8px;padding:3px 12px 3px 34px;color:var(--dim)}
.unit-row .nm{font-size:12px}
#stream{flex:1;overflow-y:auto;padding:14px 18px}
.msg{margin:0 0 12px;max-width:860px}
.msg .who{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin-bottom:3px}
.bubble{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px;white-space:pre-wrap;word-wrap:break-word}
.bubble.user{background:#152238;border-color:#274264}
.bubble.thought{background:transparent;border-style:dashed;color:var(--dim);font-style:italic}
.tc{background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--acc);border-radius:6px;padding:6px 10px;margin:6px 0;font-size:12px}
.tc .ttl{color:var(--text)} .tc .st{color:var(--dim);float:right}
.tc pre{margin:6px 0 0;max-height:180px;overflow:auto;color:var(--dim)}
.plan{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:6px 10px;margin:6px 0}
.plan .e{display:flex;gap:7px;padding:2px 0;color:var(--dim)} .plan .e.act{color:var(--text)}
.perm{border:1px solid var(--amber);border-radius:8px;padding:10px 12px;margin:8px 0;background:#1d1810}
.perm h4{margin:0 0 6px;color:var(--amber);font-size:12px}
.perm .opts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.sysline{color:var(--dim);font-size:11px;text-align:center;margin:8px 0}
#composer{flex:none;border-top:1px solid var(--line);padding:10px 14px;background:var(--panel)}
#composer textarea{width:100%;min-height:44px;max-height:140px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:8px 10px;font:inherit;resize:vertical}
#composer .row{display:flex;gap:8px;margin-top:8px;align-items:center}
#composer .hint{color:var(--dim);font-size:11px}
#tabs{display:flex;border-bottom:1px solid var(--line);flex:none;overflow-x:auto}
#tabs div{padding:8px 10px;cursor:pointer;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
#tabs div.on{color:var(--acc);border-bottom:2px solid var(--acc)}
#insp-body{flex:1;overflow-y:auto;padding:10px 12px}
.card{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:0 0 8px}
.card h5{margin:0 0 4px;font-size:12px}
.card .sub{color:var(--dim);font-size:11px}
.art{display:flex;gap:8px;padding:5px 8px;border-radius:5px;cursor:pointer;align-items:center}
.art:hover{background:var(--panel2)} .art .nm{color:var(--acc);font-size:12px}
.art .meta{margin-left:auto;color:var(--dim);font-size:10px}
.ev{display:flex;gap:8px;padding:4px 6px;border-bottom:1px solid #171c27;font-size:12px;align-items:baseline}
.ev .ts{color:var(--dim);font-size:10px;white-space:nowrap}
.ev .k{color:var(--purple);font-size:10px;min-width:110px;text-transform:uppercase}
.ev .d{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grp{color:var(--dim);font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 4px}
table.kv{width:100%;border-collapse:collapse;font-size:12px}
table.kv td{padding:3px 4px;border-bottom:1px solid #171c27}
table.kv td:first-child{color:var(--dim);width:45%}
#modal{position:fixed;inset:0;background:rgba(4,6,10,.7);display:none;align-items:center;justify-content:center;z-index:9}
#modal .box{background:var(--panel);border:1px solid var(--line);border-radius:10px;width:min(860px,92vw);max-height:84vh;display:flex;flex-direction:column}
#modal .box header{border-bottom:1px solid var(--line)}
#modal .cnt{overflow:auto;padding:16px 20px}
#modal pre{background:var(--panel2);padding:10px;border-radius:6px;overflow:auto}
.md h1,.md h2,.md h3{margin:.7em 0 .3em}.md code{background:#1c2331;padding:1px 5px;border-radius:4px}
.md blockquote{border-left:3px solid var(--line);margin:6px 0;padding:2px 12px;color:var(--dim)}
.empty{color:var(--dim);text-align:center;padding:26px 8px;font-size:12px}
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="logo">◈ AIDLC <small>cockpit</small></div>
    <div class="hdr-field">intent <b id="h-intent">—</b></div>
    <div class="hdr-field">scope <b id="h-scope">—</b></div>
    <div class="hdr-field">stage <b id="h-stage">—</b></div>
    <div class="spacer"></div>
    <div class="pill" id="h-usage" title="token usage (workspace ledger)">tokens —</div>
    <div class="pill" id="h-agent" title="ACP agent">agent —</div>
    <button id="b-session" title="start a new ACP session">new session</button>
  </header>
  <div id="cols">
    <div id="pipeline"></div>
    <div id="center">
      <div id="stream"></div>
      <div id="composer">
        <textarea id="prompt" placeholder="Prompt or steer the harness agent (ACP)…  Enter sends, Shift+Enter for newline"></textarea>
        <div class="row">
          <button class="primary" id="b-send">send</button>
          <button id="b-cancel">cancel turn</button>
          <span class="hint" id="c-hint">agent transcript streams over ACP; gates answered here feed back into the run</span>
        </div>
      </div>
    </div>
    <div id="inspector">
      <div id="tabs">
        <div data-t="gates" class="on">gates</div>
        <div data-t="artifacts">artifacts</div>
        <div data-t="activity">activity</div>
        <div data-t="usage">usage</div>
        <div data-t="intent">intent</div>
      </div>
      <div id="insp-body"></div>
    </div>
  </div>
</div>
<div id="modal"><div class="box"><header><b id="m-title" style="color:var(--text)"></b><span class="spacer"></span><button onclick="closeModal()">close</button></header><div class="cnt md" id="m-body"></div></div></div>
<script>
'use strict';
var S={snap:null,agent:{status:'off'},streams:[],curStream:null,tab:'gates',selStage:null,perms:{},selected:null};
var $=function(id){return document.getElementById(id)};
var PHASES=['initialization','ideation','inception','construction','operation'];

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function md(src){
  var s=esc(src||'');
  s=s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,function(_,c){return '<pre>'+c+'</pre>'});
  s=s.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  s=s.replace(/^###### (.*)$/gm,'<h6>$1</h6>').replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  s=s.replace(/**([^*]+)**/g,'<b>$1</b>').replace(/*([^*]+)*/g,'<i>$1</i>');
  s=s.replace(/^&gt; (.*)$/gm,'<blockquote>$1</blockquote>');
  s=s.replace(/^[-*] (.*)$/gm,'<div>• $1</div>');
  s=s.replace(/^\\d+\\. (.*)$/gm,'<div style="padding-left:8px">$&</div>');
  s=s.replace(/\\n\\n/g,'<br>').replace(/\\n/g,'<br>');
  return s;
}
function fmtTs(t){return t?String(t).replace('T',' ').replace(/\\..+$/,'').replace('Z',''):''}
function fmtNum(n){n=Number(n)||0;return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':''+n}

// ---------- pipeline ----------
function renderPipeline(){
  var el=$('pipeline');var snap=S.snap;if(!snap){el.innerHTML='<div class="empty">waiting for state…</div>';return}
  var byPhase={};PHASES.forEach(function(p){byPhase[p]=[]});
  (snap.stages||[]).forEach(function(s){(byPhase[s.phase]=byPhase[s.phase]||[]).push(s)});
  var h='';
  PHASES.forEach(function(p){
    var list=byPhase[p]||[];if(!list.length)return;
    var done=list.filter(function(s){return s.status==='completed'||s.status==='skipped'}).length;
    h+='<div class="phase"><div class="phase-h" onclick="this.parentNode.classList.toggle(\\'x\\')">'+esc(p)+'<span class="cnt">'+done+'/'+list.length+'</span></div><div class="phase-b">';
    list.forEach(function(s){
      var sel=S.selStage===s.slug?' sel':'';
      h+='<div class="stg'+sel+'" onclick="selectStage(\\''+s.slug+'\\')"><span class="dot '+esc(s.status)+'"></span><span class="num">'+esc(s.number)+'</span><span class="nm">'+esc(s.name||s.slug)+'</span><span class="ag">'+esc((s.agent||'').replace(/^aidlc-/,'').replace(/-agent$/,''))+(s.plugin?' ·'+esc(s.plugin):'')+'</span></div>';
      if(s.phase==='construction'&&snap.units&&snap.units.length){snap.units.forEach(function(u){h+='<div class="unit-row"><span class="dot '+esc(u.status)+'"></span><span class="nm">'+esc(u.slug)+(u.stage?' · '+esc(u.stage):'')+'</span></div>'})}
    });
    h+='</div></div>';
  });
  el.innerHTML=h;
}
function selectStage(slug){S.selStage=S.selStage===slug?null:slug;renderPipeline();renderInspector()}

// ---------- inspector ----------
var TABS={gates:1,artifacts:1,activity:1,usage:1,intent:1};
function renderInspector(){
  var el=$('insp-body');var snap=S.snap;
  if(!snap){el.innerHTML='<div class="empty">—</div>';return}
  var h='';
  if(S.tab==='gates'){
    var perms=S.agent.pendingPermissions||[];
    h+='<div class="grp">ACP permission requests</div>';
    if(!perms.length)h+='<div class="empty">none pending</div>';
    perms.forEach(function(p){
      h+='<div class="perm"><h4>'+esc((p.toolCall&&p.toolCall.title)||'permission')+'</h4><div class="sub">'+esc((p.toolCall&&p.toolCall.kind)||'')+'</div><div class="opts">';
      (p.options||[]).forEach(function(o){h+='<button data-p="'+esc(p.id)+'" data-o="'+esc(o.optionId)+'" class="perm-btn">'+esc(o.name||o.optionId)+'</button>'});
      h+='<button data-p="'+esc(p.id)+'" data-o="" class="perm-btn">dismiss</button></div></div>';
    });
    h+='<div class="grp">stage gates awaiting approval</div>';
    var g=(snap.stages||[]).filter(function(s){return s.status==='awaiting'||s.status==='revising'});
    if(!g.length)h+='<div class="empty">no open gates</div>';
    g.forEach(function(s){h+='<div class="card"><h5>'+esc(s.name)+' <span class="pill warn">'+esc(s.status)+'</span></h5><div class="sub">'+esc(s.slug)+' · '+(s.lastEvent?esc(fmtTs(s.lastEvent.ts)):'')+'</div><div style="margin-top:6px"><button class="primary" onclick="quick(\\'Approve\\')">approve</button> <button onclick="quick(\\'Request changes: \\')">request changes…</button></div></div>'});
    h+='<div class="grp">question files</div>';
    var q=(snap.artifacts||[]).filter(function(a){return /questions\\.md$/.test(a.name)});
    if(!q.length)h+='<div class="empty">none</div>';
    q.forEach(function(a){h+='<div class="art" onclick="openFile(\\''+esc(a.path)+'\\')"><span class="nm">'+esc(a.name)+'</span><span class="meta">'+esc(a.stage)+'</span></div>'});
  }
  else if(S.tab==='artifacts'){
    var sel=S.selStage;
    var arts=(snap.artifacts||[]).filter(function(a){return !sel||a.stage===sel});
    if(sel)h+='<div class="grp">artifacts for '+esc(sel)+' <button onclick="selectStage(\\''+esc(sel)+'\\')">clear</button></div>';
    var groups={};arts.forEach(function(a){(groups[a.stage||'(root)']=groups[a.stage||'(root)']||[]).push(a)});
    var names=Object.keys(groups).sort();
    if(!names.length)h+='<div class="empty">no artifacts yet</div>';
    names.forEach(function(gk){
      h+='<div class="grp">'+esc(gk)+'</div>';
      groups[gk].forEach(function(a){h+='<div class="art" onclick="openFile(\\''+esc(a.path)+'\\')"><span class="nm">'+esc(a.name)+'</span><span class="meta">'+fmtNum(a.size)+'B</span></div>'});
    });
  }
  else if(S.tab==='activity'){
    var evs=(snap.events||[]).slice().reverse();
    if(!evs.length)h+='<div class="empty">no audit events</div>';
    evs.forEach(function(e){
      var d=e.fields.Stage||e.fields.Unit||e.fields.Phase||e.fields.Artifact||'';
      h+='<div class="ev"><span class="ts">'+esc(fmtTs(e.ts))+'</span><span class="k">'+esc(e.event)+'</span><span class="d" title="'+esc(d)+'">'+esc(d)+'</span></div>';
    });
  }
  else if(S.tab==='usage'){
    var u=snap.usage;
    if(!u||!u.totals)h+='<div class="empty">no usage ledger yet (aidlc/.aidlc-sessions/usage-ledger.json)</div>';
    else{
      var t=u.totals.tokens||{};var tot=(t.input||0)+(t.output||0)+(t.cacheRead||0)+(t.cacheCreate5m||0)+(t.cacheCreate1h||0);
      h+='<div class="grp">workspace totals</div><table class="kv"><tr><td>input tokens</td><td>'+fmtNum(t.input)+'</td></tr><tr><td>output tokens</td><td>'+fmtNum(t.output)+'</td></tr><tr><td>cache read</td><td>'+fmtNum(t.cacheRead)+'</td></tr><tr><td>cache write</td><td>'+fmtNum((t.cacheCreate5m||0)+(t.cacheCreate1h||0))+'</td></tr><tr><td><b>total</b></td><td><b>'+fmtNum(tot)+'</b></td></tr><tr><td>cost</td><td>$'+(Number(u.totals.usd)||0).toFixed(4)+'</td></tr></table>';
      var bs=u.byStage||{};var ks=Object.keys(bs);
      if(ks.length){h+='<div class="grp">per stage</div><table class="kv">';ks.forEach(function(k){var tt=bs[k].totals||{};var tk=tt.tokens||{};h+='<tr><td>'+esc(k)+'</td><td>'+fmtNum((tk.input||0)+(tk.output||0))+' tok · $'+(Number(tt.usd)||0).toFixed(4)+'</td></tr>'});h+='</table>'}
      var bm=u.byModel||{};var km=Object.keys(bm);
      if(km.length){h+='<div class="grp">per model</div><table class="kv">';km.forEach(function(k){var tt=bm[k].tokens||{};h+='<tr><td>'+esc(k)+'</td><td>'+fmtNum((tt.input||0)+(tt.output||0))+' tok · $'+(Number(bm[k].usd)||0).toFixed(4)+'</td></tr>'});h+='</table>'}
    }
  }
  else if(S.tab==='intent'){
    var f=(snap.state&&snap.state.fields)||{};
    h+='<div class="grp">project</div><table class="kv">';
    ['Project','Project Type','Scope','Depth','Test Strategy','Start Date','Current Stage','Active Agent','Change Control','Sensors'].forEach(function(k){if(f[k]!==undefined)h+='<tr><td>'+esc(k)+'</td><td>'+esc(f[k])+'</td></tr>'});
    h+='</table><div class="grp">phases</div><table class="kv">';
    var ph=(snap.state&&snap.state.phases)||{};Object.keys(ph).forEach(function(k){h+='<tr><td>'+esc(k)+'</td><td>'+esc(ph[k])+'</td></tr>'});
    h+='</table><div class="grp">intents in space '+esc(snap.space||'default')+'</div>';
    (snap.intents||[]).forEach(function(it){h+='<div class="card"><h5>'+esc(it.slug)+(it.active?' <span class="pill ok">active</span>':'')+'</h5><div class="sub">'+esc(it.dirName)+(it.scope?' · '+esc(it.scope):'')+(it.currentStage?' · '+esc(it.currentStage):'')+'</div></div>'});
    if(!(snap.intents||[]).length)h+='<div class="empty">no intents yet — start a run from the harness</div>';
  }
  el.innerHTML=h;
  el.querySelectorAll('.perm-btn').forEach(function(b){b.onclick=function(){sendPerm(b.getAttribute('data-p'),b.getAttribute('data-o')||null)}});
}

// ---------- header ----------
function renderHeader(){
  var snap=S.snap||{};
  var act=(snap.intents||[]).filter(function(i){return i.active})[0];
  $('h-intent').textContent=act?act.slug:'—';
  $('h-scope').textContent=snap.scope||'—';
  var f=(snap.state&&snap.state.fields)||{};
  $('h-stage').textContent=f['Current Stage']||'—';
  var u=snap.usage&&snap.usage.totals;
  if(u&&u.tokens){var tk=u.tokens;$('h-usage').textContent=fmtNum((tk.input||0)+(tk.output||0))+' tok · $'+(Number(u.usd)||0).toFixed(3)}
  else $('h-usage').textContent='tokens —';
  var a=S.agent;var el=$('h-agent');
  var label=a.agentInfo?(a.agentInfo.title||a.agentInfo.name||'agent'):(a.cmd||'agent');
  el.textContent=label+' · '+a.status;
  el.className='pill '+({connected:'ok','auth-required':'warn',starting:'warn',error:'bad',exited:'bad'})[a.status]||'';
}
function quick(t){var ta=$('prompt');ta.value=t;if(t==='Approve')sendPrompt();else ta.focus()}

// ---------- stream ----------
function bubble(who,cls,text){
  var d=document.createElement('div');d.className='msg';
  d.innerHTML='<div class="who">'+esc(who)+'</div><div class="bubble '+cls+'"></div>';
  d.querySelector('.bubble').innerHTML=md(text);
  $('stream').appendChild(d);$('stream').scrollTop=1e9;return d.querySelector('.bubble');
}
function sysline(t){var d=document.createElement('div');d.className='sysline';d.textContent=t;$('stream').appendChild(d);$('stream').scrollTop=1e9}
var curAgentEl=null,curThoughtEl=null;
function onUpdate(u){
  var upd=(u&&u.update)||{};var kind=upd.sessionUpdate;
  if(kind==='agent_message_chunk'){
    var c=upd.content&&upd.content.text!==undefined?upd.content.text:(upd.content&&upd.content.text)||'';
    if(!curAgentEl)curAgentEl=bubble('agent','','');
    curAgentEl.innerHTML=md((curAgentEl._raw=(curAgentEl._raw||'')+c));
  } else if(kind==='agent_thought_chunk'){
    var c2=upd.content&&upd.content.text||'';
    if(!curThoughtEl)curThoughtEl=bubble('thinking','thought','');
    curThoughtEl.innerHTML=md((curThoughtEl._raw=(curThoughtEl._raw||'')+c2));
  } else if(kind==='user_message_chunk'){/* echoed locally */}
  else if(kind==='tool_call'||kind==='tool_call_update'){
    var id=upd.toolCallId||upd.id||('tc'+Math.random());
    var el=document.getElementById('tc-'+id);
    if(!el){el=document.createElement('div');el.className='tc';el.id='tc-'+id;$('stream').appendChild(el)}
    var locs=(upd.locations||[]).map(function(l){return l.path}).filter(Boolean).join(', ');
    el.innerHTML='<span class="st">'+esc(upd.status||'')+'</span><span class="ttl">'+esc(upd.title||upd.kind||'tool call')+'</span>'+(locs?'<div class="sub">'+esc(locs)+'</div>':'')+(upd.rawOutput?'<pre>'+esc(JSON.stringify(upd.rawOutput).slice(0,1200))+'</pre>':'');
    $('stream').scrollTop=1e9;
  } else if(kind==='plan'){
    var elp=document.getElementById('plan')||document.createElement('div');
    elp.className='plan';elp.id='plan';
    elp.innerHTML='<div class="sub" style="color:var(--dim);font-size:10px;text-transform:uppercase">plan</div>'+((upd.entries||[]).map(function(e){return '<div class="e'+(e.status==='in_progress'?' act':'')+'">'+(e.status==='completed'?'✓':e.status==='in_progress'?'▶':'○')+' '+esc(e.content||e.title||'')+'</div>'}).join(''));
    if(!elp.parentNode)$('stream').appendChild(elp);$('stream').scrollTop=1e9;
  } else if(kind==='available_commands_update'){
    sysline('slash commands: '+((upd.availableCommands||[]).map(function(c){return '/'+c.name}).join(' ')||'—'));
  } else if(kind==='current_mode_update'){
    sysline('mode → '+upd.currentModeId);
  } else if(kind==='usage_update'){
    sysline('usage update received');
  }
}
function onPerm(p){S.agent.pendingPermissions=S.agent.pendingPermissions||[];S.agent.pendingPermissions.push(p);renderInspector();sysline('permission requested: '+((p.toolCall&&p.toolCall.title)||p.id))}
function sendPerm(id,optionId){
  fetch('/api/agent/permission',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:id,optionId:optionId})});
  S.agent.pendingPermissions=(S.agent.pendingPermissions||[]).filter(function(p){return p.id!==id});renderInspector();
}
function sendPrompt(){
  var ta=$('prompt');var t=ta.value.trim();if(!t)return;ta.value='';
  bubble('you','user',t);curAgentEl=null;curThoughtEl=null;
  fetch('/api/agent/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:t})})
    .then(function(r){return r.json()}).then(function(r){if(r.error)sysline('prompt error: '+r.error)});
}
function openFile(p){
  var base=(S.snap&&S.snap.recordDir)||'';
  fetch('/api/file?p='+encodeURIComponent('aidlc/spaces/'+(S.snap.space||'default')+'/intents/'+baseName(base)+'/'+p))
    .then(function(r){return r.json()}).then(function(r){
      $('m-title').textContent=p;
      $('m-body').innerHTML=r.error?esc(r.error):md(r.content);
      $('modal').style.display='flex';
    });
}
function baseName(p){p=String(p||'').replace(/[\\\\/]+$/,'');return p.split('/').pop()||p.split('\\\\').pop()}
function closeModal(){$('modal').style.display='none'}

// ---------- wire ----------
document.querySelectorAll('#tabs div').forEach(function(d){d.onclick=function(){S.tab=d.getAttribute('data-t');document.querySelectorAll('#tabs div').forEach(function(x){x.className=x===d?'on':''});renderInspector()}});
$('b-send').onclick=sendPrompt;
$('b-cancel').onclick=function(){fetch('/api/agent/cancel',{method:'POST'});sysline('cancel sent')};
$('b-session').onclick=function(){var b=this;b.disabled=true;sysline('requesting new session…');
  fetch('/api/agent/session',{method:'POST'})
    .then(function(r){return r.json()})
    .then(function(r){b.disabled=false;sysline(r&&r.sessionId?('session → '+r.sessionId):('session error: '+((r&&r.error)||'no response')))})
    .catch(function(e){b.disabled=false;sysline('session error: '+e)});};
$('prompt').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendPrompt()}});
$('modal').addEventListener('click',function(e){if(e.target.id==='modal')closeModal()});
fetch('/api/state').then(function(r){return r.json()}).then(function(s){S.snap=s;renderHeader();renderPipeline();renderInspector()});
fetch('/api/meta').then(function(r){return r.json()}).then(function(m){if(m.agent)S.agent=m.agent;renderHeader();renderInspector()});

var es=new EventSource('/api/events');
es.addEventListener('state',function(e){S.snap=JSON.parse(e.data);renderHeader();renderPipeline();renderInspector()});
es.addEventListener('acp-status',function(e){S.agent=JSON.parse(e.data);renderHeader();renderInspector()});
es.addEventListener('acp-session',function(e){S.agent=JSON.parse(e.data);renderHeader();renderInspector()});
es.addEventListener('acp-update',function(e){onUpdate(JSON.parse(e.data))});
es.addEventListener('acp-permission',function(e){onPerm(JSON.parse(e.data))});
es.addEventListener('acp-permission-resolved',function(e){var d=JSON.parse(e.data);S.agent.pendingPermissions=(S.agent.pendingPermissions||[]).filter(function(p){return p.id!==d.id});renderInspector()});
es.addEventListener('acp-prompt-done',function(){curAgentEl=null;curThoughtEl=null});
es.addEventListener('acp-prompt-error',function(e){var d=JSON.parse(e.data);sysline('prompt error: '+(d.error||''))});
es.addEventListener('acp-notification',function(e){var d=JSON.parse(e.data);sysline(d.method)});
es.onerror=function(){};
</script>
</body>
</html>`;

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
// Any runtime that can execute this file works — harnesses invoke it via bun
// (the framework convention), and node ≥22's type stripping runs it too.
const cli = parseCli(process.argv.slice(2));
if (cli.cmd === "serve") startServer(cli);
else if (cli.cmd === "ensure") await ensure(cli);
else if (cli.cmd === "stop") await stop(cli);
else if (cli.cmd === "status") {
  const meta = await probe(cli.port, cli.host);
  console.log(
    JSON.stringify(meta ? { status: "running", ...meta } : { status: "not-running", port: cli.port }),
  );
} else {
  console.error(`unknown command ${cli.cmd} (serve|ensure|stop|status)`);
  process.exit(2);
}

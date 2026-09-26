#!/usr/bin/env bun
// cockpit-doctor.ts — /aidlc --doctor checks for the cockpit plugin.
// Prints the plugin-doctor JSON contract and nothing else on stdout.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = fileURLToPath(new URL(".", import.meta.url));
const projectDir = process.env.AIDLC_PROJECT_DIR ?? process.cwd();

function onPath(cmd: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, cmd))) return true;
  }
  return false;
}

const agentCmd = (process.env.COCKPIT_AGENT ?? "devin acp").trim().split(/\s+/)[0];

const checks = [
  {
    pass: existsSync(join(TOOLS_DIR, "cockpit-serve.ts")),
    label: "cockpit workbench tool installed",
    fix: "Re-run the plugin compose hook or `aidlc engine plugin sync` to copy tools/cockpit-serve.ts into the harness tools dir.",
  },
  {
    pass: existsSync(join(projectDir, "aidlc")),
    label: "aidlc workspace present (aidlc/)",
    fix: "Start an AI-DLC workflow first; the cockpit renders the run's on-disk state.",
    severity: "advisory",
  },
  {
    pass: onPath(agentCmd),
    label: `ACP agent command resolvable: ${agentCmd}`,
    fix: `Install the agent CLI (e.g. devin) or set COCKPIT_AGENT to an ACP command, or launch with --no-agent for a read-only board.`,
    severity: "advisory",
  },
];

console.log(JSON.stringify({ checks }));

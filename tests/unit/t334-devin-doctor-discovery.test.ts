// t334-devin-doctor-discovery: R6 — Desktop-aware doctor binary discovery
// and version floor enforcement.
//
// covers: subcommand:aidlc-utility:doctor (Devin version check block)
//
// WHAT. The Devin doctor block must:
//   - Search PATH first, then on macOS check the Desktop bundle path.
//   - Report an advisory when no binary is found (not a hard failure).
//   - Fail when the selected binary is old (below floor 3000.3.22).
//   - Fail when the selected binary exits nonzero or emits unparseable output.
//   - Pass when the selected binary is at or above the floor.
//   - Report the selected binary's source (PATH vs Desktop bundle).
//
// HOW. We manipulate PATH and create stub `devin` binaries in temp dirs to
// control which binary the doctor discovers and what it outputs. On Linux
// (CI), the macOS bundle path is never checked — we verify that too.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../harness/fixtures.ts";

const DEVIN_ROOT = join(REPO_ROOT, "dist", "devin");
const ENGINE = join(DEVIN_ROOT, ".devin");
const UTIL = join(ENGINE, "tools", "aidlc-utility.ts");

/** Create a scratch project with a pristine dist/devin install. */
function scratchProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "t334-"));
  cpSync(DEVIN_ROOT, join(dir, ".devin"), { recursive: true });
  return dir;
}

/** Create a stub `devin` binary in a dir that prints a version string. */
function stubBin(parentDir: string, versionOutput: string, exitCode = 0): string {
  const binDir = mkdtempSync(join(parentDir, "bin-"));
  const binPath = join(binDir, "devin");
  const script = `#!/bin/sh\necho '${versionOutput}'\nexit ${exitCode}\n`;
  writeFileSync(binPath, script, "utf-8");
  chmodSync(binPath, 0o755);
  return binDir;
}

/** Run doctor on a project with a custom PATH. */
function runDoctor(
  projectDir: string,
  pathOverride: string,
): { stdout: string; stderr: string; code: number } {
  const r = spawnSync(
    process.execPath,
    [UTIL, "doctor", "--project-dir", projectDir],
    {
      cwd: projectDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: pathOverride,
        AIDLC_HARNESS_DIR: ".devin",
      },
      timeout: 30_000,
    },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? -1,
  };
}

describe("t334 devin doctor — binary discovery and version floor (R6)", () => {
  test("1: supported PATH binary at floor passes (3000.3.22)", () => {
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "devin 3000.3.22");
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("3000.3.22");
      expect(out).toContain(">=");
      expect(out).toContain("PATH");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("2: newer PATH binary passes (3000.6.14)", () => {
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "devin 3000.6.14");
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("3000.6.14");
      expect(out).toContain(">=");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("3: below-floor PATH binary fails (3000.3.21)", () => {
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "devin 3000.3.21");
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("3000.3.21");
      expect(out).toContain("<");
      expect(out).toContain("3000.3.22");
      expect(out).toContain("upgrade");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("4: nonzero exit from version command fails (not advisory)", () => {
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "error", 1);
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("version check failed");
      expect(out).not.toContain("unverified");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("5: malformed version output fails (not advisory)", () => {
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "not a version string");
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("version check failed");
      expect(out).not.toContain("unverified");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("6: no binary on PATH (Linux) → advisory, not failure", () => {
    const proj = scratchProject();
    try {
      // PATH with no devin binary — use a dir that definitely has no devin.
      const emptyDir = mkdtempSync(join(tmpdir(), "t334-empty-"));
      const r = runDoctor(proj, emptyDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("unverified");
      expect(out).toContain("no `devin` on PATH");
      // On Linux, no bundle check is performed — the message should NOT
      // mention a Desktop bundle. On macOS, it should mention it.
      if (process.platform !== "darwin") {
        expect(out).not.toContain("no Desktop bundle");
      } else {
        expect(out).toContain("no Desktop bundle");
      }
      rmSync(emptyDir, { recursive: true, force: true });
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("7: selected binary source is reported (PATH)", () => {
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "devin 3000.3.22");
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("PATH");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("8: floor is 3000.3.22 (not 3000.3.0)", () => {
    // A 3000.3.10 binary would pass the old floor but must fail the new one.
    const proj = scratchProject();
    try {
      const binDir = stubBin(proj, "devin 3000.3.10");
      const r = runDoctor(proj, binDir);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("<");
      expect(out).toContain("3000.3.22");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

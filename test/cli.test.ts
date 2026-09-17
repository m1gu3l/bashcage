import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after } from "node:test";
import { CONFIG_FILE, DEFAULT_ALLOWED } from "../src/allowlist.ts";

const BIN = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const ALLOW = ["echo", "true", "false", "git add"];

// A project tree with .bashcage.json at the root and a nested working
// directory, so the walk-up lookup is exercised by every test.
const ROOT = mkdtempSync(join(tmpdir(), "bashcage-cli-"));
const CWD = join(ROOT, "sub", "dir");
mkdirSync(CWD, { recursive: true });
writeFileSync(join(ROOT, CONFIG_FILE), JSON.stringify({ allow: ALLOW }));
after(() => rmSync(ROOT, { recursive: true, force: true }));

function bashcage(args: string[], input?: string, cwd = CWD) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    input: input ?? "",
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("wrapper runs an allowed command and propagates its exit code", () => {
  const ok = bashcage(["echo", "hi"]);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "hi\n");

  assert.equal(bashcage(["false"]).status, 1);
  assert.equal(bashcage(["--", "true"]).status, 0);
});

test("wrapper blocks a command that is not allowed with exit 2", () => {
  const r = bashcage(["echo hi && rm -rf /tmp/nope"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /Blocked: 'rm' is not allowed/);
});

test("--check does not run the command", () => {
  const r = bashcage(["--check", "echo", "hi"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(bashcage(["-c", "git push"]).status, 2);
});

test("--pre-tool-hook reads tool_input.command from stdin and does not run it", () => {
  const hook = (command: string) => JSON.stringify({ tool_input: { command } });
  const ok = bashcage(["--pre-tool-hook"], hook("echo hi"));
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "");

  const blocked = bashcage(["--pre-tool-hook"], hook("git push"));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /'git'/);
});

test("--pre-tool-hook approves bashcage's read-only invocations without an entry", () => {
  const hook = (command: string) => JSON.stringify({ tool_input: { command } });
  assert.equal(bashcage(["--pre-tool-hook"], hook("./node_modules/.bin/bashcage --list")).status, 0);
  assert.equal(bashcage(["--pre-tool-hook"], hook("bashcage --check 'rm -rf /'")).status, 0);
  assert.equal(bashcage(["--pre-tool-hook"], hook("bashcage --help")).status, 0);
  const wrapper = bashcage(["--pre-tool-hook"], hook("bashcage git push"));
  assert.equal(wrapper.status, 2);
  assert.match(wrapper.stderr, /'bashcage' is not allowed/);
});

test("--pre-tool-hook tolerates empty stdin and JSON without a command", () => {
  assert.equal(bashcage(["--pre-tool-hook"], "").status, 0);
  assert.equal(bashcage(["--pre-tool-hook"], "{}").status, 0);
  assert.equal(bashcage(["--pre-tool-hook"], '{"tool_input":{"command":42}}').status, 0);
});

test("--pre-tool-hook rejects stdin that is not JSON by blocking, not letting it through", () => {
  const r = bashcage(["--pre-tool-hook"], "not json");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid hook JSON/);
});

test("--pre-tool-hook and COMMAND are mutually exclusive, and blocks rather than passing through", () => {
  const r = bashcage(["--pre-tool-hook", "echo", "hi"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /takes no COMMAND/);
});

test("no COMMAND without --pre-tool-hook is an error, not a stdin read", () => {
  const r = bashcage([], JSON.stringify({ tool_input: { command: "git push" } }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing COMMAND/);
});

test("--init prints setup instructions for the project and writes nothing", () => {
  const r = bashcage(["--init"]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  // Running from src/, not node_modules, so the global bin is suggested.
  assert.match(r.stdout, /"command": "bashcage --pre-tool-hook"/);
  assert.match(r.stdout, /\.claude\/settings\.json/);
  assert.doesNotMatch(r.stdout, /\{\{/);
});

test("--doctor prints audit instructions listing the active allowlist and writes nothing", () => {
  const r = bashcage(["--doctor"]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /`bashcage --check '<command>'`/);
  assert.match(r.stdout, new RegExp(join(realpathSync(ROOT), CONFIG_FILE).replaceAll(".", "\\.")));
  for (const entry of ALLOW) assert.ok(r.stdout.includes(`- \`${entry}\`\n`), entry);
  assert.doesNotMatch(r.stdout, /\{\{/);
});

test("--doctor says so when the built-in default allowlist is in use", () => {
  const dir = mkdtempSync(join(tmpdir(), "bashcage-noconf-"));
  try {
    const r = bashcage(["--doctor"], "", dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /built-in default/);
    for (const entry of DEFAULT_ALLOWED) assert.ok(r.stdout.includes(`- \`${entry}\``), entry);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--list prints the allowlist one per line", () => {
  const r = bashcage(["--list"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "echo\ntrue\nfalse\ngit add\n");
});

test("--config prints the path of the config file in use", () => {
  const r = bashcage(["--config"]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  // The child's cwd is resolved through symlinks (/var -> /private/var on macOS).
  assert.equal(r.stdout, join(realpathSync(ROOT), CONFIG_FILE) + "\n");
});

test("--config exits 1 and prints nothing to stdout when no config file is found", () => {
  const dir = mkdtempSync(join(tmpdir(), "bashcage-noconf-"));
  try {
    const r = bashcage(["--config"], "", dir);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /no "\.bashcage\.json" found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uses the default allowlist when no config file is found", () => {
  const dir = mkdtempSync(join(tmpdir(), "bashcage-noconf-"));
  try {
    const r = bashcage(["--list"], "", dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, DEFAULT_ALLOWED.join("\n") + "\n");
    assert.equal(bashcage(["-c", "echo hi"], "", dir).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken config file is an error, not a fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "bashcage-badconf-"));
  try {
    writeFileSync(join(dir, CONFIG_FILE), '{ "allow": "ls" }');
    const r = bashcage(["-c", "ls"], "", dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\.bashcage\.json: "allow" must be an array of strings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--pre-tool-hook blocks (not passes through) when the config file is broken", () => {
  const dir = mkdtempSync(join(tmpdir(), "bashcage-badconf-hook-"));
  try {
    writeFileSync(join(dir, CONFIG_FILE), '{ "allow": ["ls"] }x');
    const hook = JSON.stringify({ tool_input: { command: "ls" } });
    const r = bashcage(["--pre-tool-hook"], hook, dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.bashcage\.json: not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help shows usage but not the allowlist, --version shows the version", () => {
  const help = bashcage(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: bashcage/);
  assert.match(help.stdout, /--check/);
  assert.match(help.stdout, /--pre-tool-hook/);
  assert.match(help.stdout, /--init/);
  assert.match(help.stdout, /--doctor/);
  // The allowlist and its source belong to --list and --config, not --help.
  assert.doesNotMatch(help.stdout, /git add/);
  assert.doesNotMatch(help.stdout, /Allowlist \(/);

  const version = bashcage(["--version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});

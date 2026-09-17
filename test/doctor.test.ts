import { test } from "node:test";
import assert from "node:assert/strict";
import { type LoadedAllow } from "../src/allowlist.ts";
import { allowList, doctorInstructions, sourceNote } from "../src/doctor.ts";

const CWD = "/proj";
const FROM_FILE: LoadedAllow = { allowed: ["ls", "git add", "npm"], path: "/proj/.bashcage.json" };

test("sourceNote names the config file in use", () => {
  const file = sourceNote(FROM_FILE, "bashcage");
  assert.match(file, /`\/proj\/\.bashcage\.json`/);
  assert.match(file, /`bashcage --config`/);
});

test("allowList renders one entry per line, or a note when empty", () => {
  assert.equal(allowList(["ls", "git add"]), "- `ls`\n- `git add`");
  assert.match(allowList([]), /empty/);
});

test("doctorInstructions fills in the bin, the source, and every entry", () => {
  const local = doctorInstructions(CWD, "/proj/node_modules/bashcage/dist/cli.js", FROM_FILE);
  assert.match(local, /`\.\/node_modules\/\.bin\/bashcage --check '<command>'`/);
  assert.match(local, /`\.\/node_modules\/\.bin\/bashcage --list`/);
  assert.match(local, /\/proj\/\.bashcage\.json/);
  for (const entry of FROM_FILE.allowed) assert.ok(local.includes(`- \`${entry}\`\n`), entry);
  // The audit explains what bashcage does and does not check.
  assert.match(local, /Arguments are never checked/);
  assert.match(local, /Command substitution/);
  // The audit asks for a verdict per entry and for no edits before agreement.
  assert.match(local, /\*\*safe\*\*, \*\*caution\*\*, or \*\*unsafe\*\*/);
  assert.match(local, /Do not edit any file until the user has agreed/);
  assert.doesNotMatch(local, /\{\{/);

  const global = doctorInstructions(CWD, "/usr/local/lib/node_modules/bashcage/dist/cli.js", FROM_FILE);
  assert.match(global, /`bashcage --check '<command>'`/);
  for (const entry of FROM_FILE.allowed) assert.ok(global.includes(`- \`${entry}\`\n`) || global.endsWith(`- \`${entry}\``), entry);
  assert.doesNotMatch(global, /\{\{/);
});

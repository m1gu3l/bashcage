import { test } from "node:test";
import assert from "node:assert/strict";
import { binCommand, initInstructions, render } from "../src/init.ts";

const CWD = "/proj";

test("render fills placeholders and rejects unknown ones", () => {
  assert.equal(render("a {{x}} {{x}}{{y}}", { x: "1", y: "2" }), "a 1 12");
  assert.throws(() => render("{{nope}}", {}), /unknown placeholder \{\{nope}}/);
});

test("binCommand uses the project-local bin only when running from the project's node_modules", () => {
  const local = "./node_modules/.bin/bashcage";
  assert.equal(binCommand(CWD, "/proj/node_modules/bashcage/dist/cli.js"), local);
  assert.equal(binCommand(CWD, "/proj/node_modules/.pnpm/bashcage@0.1.0/node_modules/bashcage/dist/cli.js"), local);

  assert.equal(binCommand(CWD, "/usr/local/lib/node_modules/bashcage/dist/cli.js"), "bashcage");
  assert.equal(binCommand(CWD, "/proj/src/cli.ts"), "bashcage");
  assert.equal(binCommand(CWD, "/proj/node_modules_other/bashcage/dist/cli.js"), "bashcage");
  assert.equal(binCommand(CWD, "/other/node_modules/bashcage/dist/cli.js"), "bashcage");
});

test("initInstructions fills in the bin and the hook JSON, with no built-in default", () => {
  const local = initInstructions(CWD, "/proj/node_modules/bashcage/dist/cli.js");
  assert.match(local, /"command": "\.\/node_modules\/\.bin\/bashcage --pre-tool-hook"/);
  assert.match(local, /`\.\/node_modules\/\.bin\/bashcage --list`/);
  assert.match(local, /no built-in default/);
  assert.doesNotMatch(local, /"bashcage"\n/);
  assert.match(local, /\.claude\/settings\.json/);
  assert.match(local, /CLAUDE\.md/);
  assert.match(local, /\/hooks/);
  assert.doesNotMatch(local, /\{\{/);

  const global = initInstructions(CWD, "/usr/local/lib/node_modules/bashcage/dist/cli.js");
  assert.match(global, /"command": "bashcage --pre-tool-hook"/);
  assert.match(global, /`bashcage --list`/);
  assert.doesNotMatch(global, /\{\{/);
});

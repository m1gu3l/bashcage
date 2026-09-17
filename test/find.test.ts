import { test } from "node:test";
import assert from "node:assert/strict";
import { check, parseCommand } from "../src/check.ts";
import { findExecCommands, isFind } from "../src/find.ts";

const ALLOW = ["find", "grep", "cat"];
const ok = (cmd: string, allow: readonly string[] = ALLOW) =>
  assert.equal(check(cmd, allow).ok, true, cmd);
const blocked = (cmd: string, fragment?: RegExp, allow: readonly string[] = ALLOW) => {
  const r = check(cmd, allow);
  assert.equal(r.ok, false, cmd);
  if (fragment && !r.ok) assert.match(r.reason, fragment);
};
const first = (cmd: string) => {
  const r = parseCommand(cmd);
  assert.equal(r.ok, true, cmd);
  return (r.ok && r.commands[0]) || { words: [], literalWords: 0, redirects: [] };
};
const nested = (cmd: string) => {
  const r = findExecCommands(first(cmd));
  assert.equal(r.ok, true, cmd);
  return r.ok ? r.commands.map((c) => c.words) : [];
};

test("isFind recognises only a literal find program", () => {
  assert.equal(isFind(first("find .")), true);
  assert.equal(isFind(first("/usr/bin/find .")), true);
  assert.equal(isFind(first("grep find")), false);
  assert.equal(isFind(first("$X/find .")), false);
});

test("lifts each exec clause out as a command", () => {
  assert.deepEqual(nested("find . -name '*.ts' -exec grep -l foo {} \\;"), [["grep", "-l", "foo", "{}"]]);
  assert.deepEqual(nested("find . -exec grep foo {} +"), [["grep", "foo", "{}"]]);
  assert.deepEqual(nested("find . -exec cat {} ';'"), [["cat", "{}"]]);
  assert.deepEqual(nested("find . -execdir /bin/cat {} \\; -ok grep x {} \\;"), [
    ["cat", "{}"],
    ["grep", "x", "{}"],
  ]);
  assert.deepEqual(nested("find . -name x -print"), []);
});

test("allows find -exec of an allowlisted command", () => {
  ok("find . -name '*.ts' -exec grep -l foo {} \\;");
  ok("find . -type f -exec cat {} +");
  ok("find src -execdir grep foo {} \\; -o -okdir cat {} \\;");
  ok("find . -exec grep foo {} \\; | grep bar");
});

test("blocks find -exec of a non-allowlisted command", () => {
  blocked("find . -name x -exec rm {} \\;", /'rm'/);
  blocked("find . -exec rm -rf {} +", /'rm'/);
  blocked("find . -execdir sh -c 'id' \\;", /'sh'/);
  blocked("find . -ok mv {} /tmp \\;", /'mv'/);
  blocked("find . -exec grep x {} \\; -exec rm {} \\;", /'rm'/);
  blocked("find . -exec /bin/rm {} \\;", /'rm'/);
  blocked("find . -exec {} \\;", /'\{\}'/);
  blocked("find . -exec ./{} \\;", /'\{\}'/);
});

test("blocks an exec clause without a terminator or without a command", () => {
  blocked("find . -exec rm {}", /no terminating/);
  blocked("find . -exec grep foo {}", /no terminating/);
  blocked("find . -exec \\;", /no command/);
});

test("blocks find arguments that need expansion", () => {
  blocked('find "$dir" -name x', /must be literal/);
  blocked("find . $flags", /must be literal/);
  blocked('find . -exec grep "$pat" {} \\;', /must be literal/);
});

test("find still needs its own entry", () => {
  blocked("find . -exec grep x {} \\;", /'find'/, ["grep"]);
});

test("an exec clause nested in an exec clause has no terminator of its own", () => {
  blocked("find . -exec find {} -exec rm {} \\; \\;", /no terminating/);
});

test("a non-find command is untouched", () => {
  ok("grep -r -exec rm .");
  ok("cat -exec");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILE,
  ConfigError,
  DEFAULT_ALLOWED,
  findConfig,
  loadAllow,
  parseConfig,
} from "../src/allowlist.ts";

test("parseConfig reads the allow array, trims entries, and drops empties", () => {
  assert.deepEqual(parseConfig('{ "allow": ["git add"] }'), ["git add"]);
  assert.deepEqual(parseConfig('{ "allow": [" cdk ", "", "aws", "  "] }'), ["cdk", "aws"]);
  assert.deepEqual(parseConfig('{ "allow": [] }'), []);
});

test("parseConfig rejects anything that is not { allow: string[] }", () => {
  const rejects = (text: string, detail: RegExp) =>
    assert.throws(() => parseConfig(text, "x.json"), (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.path, "x.json");
      assert.match(err.message, /^x\.json: /);
      assert.match(err.message, detail);
      return true;
    });
  rejects("not json", /not valid JSON/);
  rejects("[]", /expected an object/);
  rejects("null", /expected an object/);
  rejects("{}", /"allow" must be an array/);
  rejects('{ "allow": "git add" }', /"allow" must be an array/);
  rejects('{ "allow": ["ls", 42] }', /"allow"\[1\] must be a string/);
});

function withTempDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "bashcage-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("findConfig walks up to the nearest config file", () => {
  withTempDir((dir) => {
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    assert.equal(findConfig(nested), null);

    writeFileSync(join(dir, CONFIG_FILE), "{}");
    assert.equal(findConfig(nested), join(dir, CONFIG_FILE));

    writeFileSync(join(dir, "a", CONFIG_FILE), "{}");
    assert.equal(findConfig(nested), join(dir, "a", CONFIG_FILE));
  });
});

test("findConfig ignores a directory with the config file's name", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, CONFIG_FILE));
    assert.equal(findConfig(dir), null);
  });
});

test("loadAllow uses the config file, else the default", () => {
  withTempDir((dir) => {
    assert.deepEqual(loadAllow(dir), { allowed: DEFAULT_ALLOWED, source: { kind: "default" } });

    const path = join(dir, CONFIG_FILE);
    writeFileSync(path, '{ "allow": ["git add"] }');
    assert.deepEqual(loadAllow(dir), { allowed: ["git add"], source: { kind: "file", path } });

    writeFileSync(path, "{");
    assert.throws(() => loadAllow(dir), ConfigError);
  });
});

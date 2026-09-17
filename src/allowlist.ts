/**
 * Allowlist resolution.
 *
 * The allowlist is the "allow" array of the nearest .bashcage.json found by
 * walking up from the working directory. There is no default: a missing
 * config file is an error, just like one that exists but cannot be used, so
 * a project can never run commands without an explicit, reviewed allowlist.
 *
 * Parsing is separated from file access so it can be unit tested directly.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Name of the config file looked up from the working directory upwards. */
export const CONFIG_FILE = ".bashcage.json";

/** Thrown when the config file is missing or cannot be used. */
export class ConfigError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "ConfigError";
    this.path = path;
  }
}

/** Thrown when no config file is found in the working directory or its parents. */
export class ConfigNotFoundError extends ConfigError {
  constructor(cwd: string) {
    super(CONFIG_FILE, `not found in ${cwd} or its parents`);
    this.name = "ConfigNotFoundError";
  }
}

/**
 * Parse the text of a config file. The shape is `{ "allow": ["git add"] }`.
 * Entries are trimmed and empties dropped. Any other shape throws ConfigError.
 */
export function parseConfig(text: string, path = CONFIG_FILE): readonly string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(path, `not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError(path, 'expected an object like { "allow": ["git add"] }');
  }
  const allow = (data as { allow?: unknown }).allow;
  if (!Array.isArray(allow)) {
    throw new ConfigError(path, '"allow" must be an array of strings');
  }
  const entries: string[] = [];
  for (const [i, entry] of allow.entries()) {
    if (typeof entry !== "string") {
      throw new ConfigError(path, `"allow"[${i}] must be a string`);
    }
    const trimmed = entry.trim();
    if (trimmed) entries.push(trimmed);
  }
  return entries;
}

/**
 * Path of the nearest CONFIG_FILE in `startDir` or any of its ancestors, or
 * null if there is none. Only regular files count.
 */
export function findConfig(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The active allowlist and the config file it came from. */
export type LoadedAllow = { allowed: readonly string[]; path: string };

/**
 * Load the allowlist for a working directory: the nearest config file.
 * Throws ConfigNotFoundError if none is found, or ConfigError if one is
 * found but unusable.
 */
export function loadAllow(cwd: string): LoadedAllow {
  const path = findConfig(cwd);
  if (path === null) throw new ConfigNotFoundError(cwd);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(path, `cannot read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { allowed: parseConfig(text, path), path };
}

#!/usr/bin/env node
/**
 * bashcage: allowlist guard for shell commands.
 *
 * `bashcage [--] COMMAND...` checks the command (joined from all positional
 * words) against the allowlist and, if allowed, runs it through bash with the
 * child's exit code propagated. A blocked command never runs and exits 2.
 *
 * `bashcage --check [--] COMMAND...` only checks, exiting 0 or 2.
 *
 * `bashcage --list` prints the allowlist, one entry per line.
 *
 * `bashcage --config` prints the path of the .bashcage.json in use and exits
 * 0; with no such file it says so on stderr and exits 1.
 *
 * `bashcage --pre-tool-hook` reads Claude Code hook JSON on stdin, checks
 * tool_input.command, and exits 0 to pass or 2 to block. Nothing is run.
 *
 * `bashcage --init` prints setup instructions for Claude Code, meant to be
 * piped into claude. Nothing is written.
 *
 * `bashcage --doctor` prints instructions for Claude Code to audit every
 * entry of the active allowlist for safety, meant to be piped into claude.
 * Nothing is written.
 *
 * Allowlist: the "allow" array of the nearest .bashcage.json found walking up
 * from the working directory, else DEFAULT_ALLOWED in src/allowlist.ts.
 * Entries may be multi-word prefixes like "git add".
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { object } from "@optique/core/constructs";
import { message, text, value } from "@optique/core/message";
import { multiple } from "@optique/core/modifiers";
import { argument, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { printError, run } from "@optique/run";
import pkg from "../package.json" with { type: "json" };
import { CONFIG_FILE, ConfigError, loadAllow, type LoadedAllow } from "./allowlist.ts";
import { check } from "./check.ts";
import { doctorInstructions } from "./doctor.ts";
import { initInstructions } from "./init.ts";

/** Exit code for a blocked command. Claude Code treats 2 as "block". */
const EXIT_BLOCKED = 2;

let loaded: LoadedAllow;
try {
  loaded = loadAllow(process.cwd());
} catch (err) {
  if (err instanceof ConfigError) printError(message`${text(err.message)}`, { exitCode: 1 });
  throw err;
}
const { allowed, source } = loaded;

const parser = object({
  check: option("-c", "--check", {
    description: message`Only check COMMAND, do not run it.`,
  }),
  list: option("-l", "--list", {
    description: message`Print the allowlist, one entry per line, and exit.`,
  }),
  config: option("--config", {
    description: message`Print the path of the ${value(CONFIG_FILE)} in use and exit; exit 1 if none was found and the built-in default applies.`,
  }),
  preToolHook: option("--pre-tool-hook", {
    description: message`Read Claude Code PreToolUse hook JSON from stdin and only check its tool_input.command. Nothing is run.`,
  }),
  init: option("--init", {
    description: message`Print setup instructions for Claude Code and exit; pipe them into claude to have it set this project up (bashcage --init | claude). Nothing is written.`,
  }),
  doctor: option("--doctor", {
    description: message`Print instructions for Claude Code to audit the active allowlist and exit; pipe them into claude to have it check that every entry is safe with any arguments (bashcage --doctor | claude). Nothing is written.`,
  }),
  cmd: multiple(
    argument(string({ metavar: "COMMAND" }), {
      description: message`Command to run, as one quoted string or several words (put -- before words that start with a dash).`,
    }),
  ),
});

const opts = run(parser, {
  programName: "bashcage",
  version: pkg.version,
  help: "option",
  brief: message`Runs a shell command only if every simple command in it is on the allowlist.`,
});

if (opts.list) {
  process.stdout.write(allowed.join("\n") + "\n");
  process.exit(0);
}

if (opts.config) {
  if (source.kind === "file") {
    process.stdout.write(source.path + "\n");
    process.exit(0);
  }
  printError(message`no ${value(CONFIG_FILE)} found in ${value(process.cwd())} or its parents; using the built-in default allowlist`, {
    exitCode: 1,
  });
}

if (opts.init) {
  process.stdout.write(initInstructions(process.cwd(), process.argv[1] ?? ""));
  process.exit(0);
}

if (opts.doctor) {
  process.stdout.write(doctorInstructions(process.cwd(), process.argv[1] ?? "", loaded));
  process.exit(0);
}

/** Read Claude Code hook JSON from stdin and return the command to check. */
function readHookCommand(): string {
  let input: string;
  try {
    input = readFileSync(process.stdin.fd, "utf8");
  } catch {
    return "";
  }
  if (!input.trim()) return "";

  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return printError(message`stdin was not valid hook JSON`, { exitCode: 1 });
  }
  if (typeof data !== "object" || data === null) return "";
  const toolInput = (data as { tool_input?: unknown }).tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return "";
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === "string" ? command : "";
}

if (opts.preToolHook && opts.cmd.length > 0) {
  printError(message`--pre-tool-hook reads the command from stdin and takes no COMMAND`, { exitCode: 1 });
}
if (!opts.preToolHook && opts.cmd.length === 0) {
  printError(message`missing COMMAND (use --pre-tool-hook to read hook JSON from stdin)`, { exitCode: 1 });
}

const argCmd = opts.preToolHook ? undefined : opts.cmd.join(" ");
const result = check(argCmd ?? readHookCommand(), allowed);

if (!result.ok) {
  process.stderr.write(result.reason + "\n");
  process.exit(EXIT_BLOCKED);
}

if (opts.check || argCmd === undefined) {
  process.exit(0);
}

const child = spawnSync("bash", ["-c", argCmd], { stdio: "inherit" });
if (child.error) {
  printError(message`could not run bash: ${child.error.message}`, { exitCode: 1 });
}
if (child.signal) {
  // Re-raise so the parent sees the same termination the child got.
  process.kill(process.pid, child.signal);
}
process.exit(child.status ?? 1);

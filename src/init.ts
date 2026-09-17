/**
 * `bashcage --init`: setup instructions for Claude Code, written for Claude.
 *
 * bashcage writes nothing itself. The text is meant to be piped into Claude
 * (`bashcage --init | claude`), which merges the hook into the project's
 * settings, writes the allowlist, and checks that the hook fires. The prose
 * lives in INIT_INSTRUCTIONS.md next to this file (copied into dist/ by the
 * build); this module only fills in the `{{placeholders}}` that must be
 * exact and in step with the code: the bin path and the hook JSON. There is
 * no default allowlist to suggest; Claude asks the user what to allow.
 * Anything that depends on the state of the project is left to Claude to
 * check.
 */
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Beside this module in src/, and beside the bundle in dist/ (see tsdown copy). */
const TEMPLATE_URL = new URL("./INIT_INSTRUCTIONS.md", import.meta.url);

/**
 * How to invoke bashcage from this project: the project-local bin when the
 * running binary lives in the project's node_modules (no npx start-up on
 * every Bash call), else the global `bashcage`.
 */
export function binCommand(cwd: string, binPath: string): string {
  const local = join(resolve(cwd), "node_modules") + sep;
  return resolve(cwd, binPath).startsWith(local) ? "./node_modules/.bin/bashcage" : "bashcage";
}

/** Replace every `{{name}}`; an unknown name is an error, not silent output. */
export function render(template: string, vars: Record<string, string>, templateName = "INIT_INSTRUCTIONS.md"): string {
  return template.replace(/\{\{(\w+)}}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`${templateName}: unknown placeholder {{${name}}}`);
    return value;
  });
}

export function initInstructions(cwd: string, binPath: string): string {
  const bin = binCommand(cwd, binPath);
  const hook = { matcher: "Bash", hooks: [{ type: "command", command: `${bin} --pre-tool-hook`, timeout: 10 }] };
  return render(readFileSync(TEMPLATE_URL, "utf8"), {
    bin,
    hookJson: JSON.stringify({ hooks: { PreToolUse: [hook] } }, null, 2),
  });
}

/**
 * `bashcage --doctor`: audit instructions for Claude Code, written for Claude.
 *
 * Like --init, bashcage writes nothing itself. The text is meant to be piped
 * into Claude (`bashcage --doctor | claude`), which then judges every entry
 * of the active allowlist for what it lets a command do through its
 * arguments, which bashcage by design does not check. The prose lives in
 * DOCTOR_INSTRUCTIONS.md next to this file (copied into dist/ by the build);
 * this module fills in the `{{placeholders}}` that must be exact: the bin
 * path, where the allowlist came from, and the entries themselves.
 */
import { readFileSync } from "node:fs";
import { CONFIG_FILE, type LoadedAllow } from "./allowlist.ts";
import { binCommand, render } from "./init.ts";

/** Beside this module in src/, and beside the bundle in dist/ (see tsdown copy). */
const TEMPLATE_URL = new URL("./DOCTOR_INSTRUCTIONS.md", import.meta.url);

/** One sentence on where the allowlist came from, for the top of the audit. */
export function sourceNote(loaded: LoadedAllow, bin: string): string {
  return `These are the entries of the \`allow\` array in \`${loaded.path}\`, the nearest \`${CONFIG_FILE}\` looked up from the project directory upwards (\`${bin} --config\` prints this path).`;
}

/** The entries as a Markdown list, or a note when there are none. */
export function allowList(allowed: readonly string[]): string {
  if (allowed.length === 0) return "_The allowlist is empty: every Bash tool call is blocked. There is nothing to audit; ask the user what they want to allow._";
  return allowed.map((entry) => `- \`${entry}\``).join("\n");
}

export function doctorInstructions(cwd: string, binPath: string, loaded: LoadedAllow): string {
  const bin = binCommand(cwd, binPath);
  return render(readFileSync(TEMPLATE_URL, "utf8"), {
    bin,
    sourceNote: sourceNote(loaded, bin),
    allowList: allowList(loaded.allowed),
  }, "DOCTOR_INSTRUCTIONS.md");
}

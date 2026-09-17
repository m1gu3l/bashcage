/**
 * `find -exec` support. Kept apart from the core check so the generic
 * allowlist logic stays free of per-program knowledge.
 *
 * `find` is a launcher: `-exec`, `-execdir`, `-ok` and `-okdir` run a
 * command for every match, so an allowlist entry for `find` would otherwise
 * allow every program. Instead, each such clause is lifted out as a nested
 * simple command, so `find . -exec rm {} \;` is judged by whether `rm` is
 * allowlisted, exactly as if `rm` appeared at the top level. The clause runs
 * from the action flag up to the terminating `;` (usually written `\;`) or
 * `+`; `{}` is kept as an ordinary argument, where it never affects entry
 * matching.
 *
 * Every argument to `find` must be literal. A word that needs expansion,
 * like `"$flag"` or `$args`, could turn into `-exec` at runtime, and then
 * the command we checked is not the command that runs.
 *
 * Nothing here looks at `-delete` or the `-fprint` family, which write
 * without spawning a program.
 */
import type { SimpleCommand } from "./check.ts";

export type NestedResult = { ok: true; commands: SimpleCommand[] } | { ok: false; reason: string };

/** find primaries that run a program. */
const EXEC_FLAGS: ReadonlySet<string> = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** Words that end an exec clause. `\;` survives unquoting as written. */
const TERMINATORS: ReadonlySet<string> = new Set([";", "\\;", "+"]);

/** Whether this simple command is a `find` invocation this module handles. */
export function isFind(command: SimpleCommand): boolean {
  return command.literalWords >= 1 && command.words[0] === "find";
}

/**
 * The commands a `find` invocation would run through its exec primaries.
 * Empty for a `find` without any. Blocked if an argument is not literal or
 * a clause has no terminator.
 */
export function findExecCommands(command: SimpleCommand): NestedResult {
  const { words, literalWords } = command;
  if (literalWords < words.length) {
    return {
      ok: false,
      reason: `Blocked: find argument '${words[literalWords]}' must be literal, since it could expand to -exec.`,
    };
  }
  const commands: SimpleCommand[] = [];
  for (let i = 1; i < words.length; i++) {
    const flag = words[i] ?? "";
    if (!EXEC_FLAGS.has(flag)) continue;
    const start = i + 1;
    let end = start;
    while (end < words.length && !TERMINATORS.has(words[end] ?? "")) end++;
    if (end === words.length) {
      return { ok: false, reason: `Blocked: find ${flag} has no terminating ';' or '+'.` };
    }
    const [program, ...args] = words.slice(start, end);
    if (program === undefined) {
      return { ok: false, reason: `Blocked: find ${flag} has no command.` };
    }
    const body = [program.slice(program.lastIndexOf("/") + 1), ...args];
    commands.push({ words: body, literalWords: body.length, redirects: [] });
    i = end;
  }
  return { ok: true, commands };
}

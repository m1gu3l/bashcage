/**
 * Core allowlist logic. No I/O here so it can be unit tested directly.
 *
 * The command line is parsed with mvdan/sh (bash 5.2 grammar) and only a
 * small, explicit set of syntax is accepted: simple commands, pipelines,
 * `&& || ; &` chains, literal or quoted words, parameter expansions, and
 * harmless redirections. Every other node type (command and process
 * substitution, subshells, command groups, functions, loops, arithmetic, ...)
 * is blocked by construction, so there is no denylist to keep complete.
 *
 * An allowlist entry is one or more words. A simple command matches an entry
 * when its leading words (with any path prefix stripped from the program
 * name) equal the entry's words. So "git add" allows "git add -A" but not
 * "git push". Only literal words can match: a word that needs expansion, like
 * `$X/ls`, never equals an entry. bashcage's own read-only invocations
 * (READONLY_SELF) are allowed without an entry.
 *
 * Leading environment assignments are blocked outright, including on their
 * own (`FOO=1`). `PATH=/tmp ls`, `LD_PRELOAD=x.so ls` or
 * `GIT_EXTERNAL_DIFF=x git diff` all change which code runs under an
 * allowlisted name, so no entry could be safe with any arguments if they were
 * let through, and a denylist of dangerous variable names could never be
 * complete.
 *
 * Redirections are checked separately: anything that writes to a path other
 * than /dev/null is blocked, since it would turn a read-only allowlisted
 * command into a file writer. Input redirections, heredocs, and fd
 * duplications like 2>&1 are allowed.
 */
import { Buffer } from "node:buffer";
import sh from "mvdan-sh";

const { syntax } = sh;

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** One redirection, e.g. `2>&1` is { fd: "2", op: ">&", target: "1" }. */
export type Redirect = { fd: string; op: string; target: string };

/**
 * One simple command. Literal words are unquoted; words that need expansion
 * are kept as written (e.g. `"$f"`) so they can be shown. `literalWords` is
 * how many leading words are literal: only those can match an allowlist entry.
 */
export type SimpleCommand = { words: string[]; literalWords: number; redirects: Redirect[] };

export type ParseResult =
  | { ok: true; commands: SimpleCommand[] }
  | { ok: false; reason: string };

/**
 * Node types that may appear in an allowed command. Anything else is blocked.
 * ParamExp children (Expansion, Replace, Slice) are data; a substitution
 * hidden inside one, like `${x:-$(cmd)}`, is still visited and blocked.
 */
const ALLOWED_NODES: ReadonlySet<string> = new Set([
  "File",
  "Stmt",
  "CallExpr",
  "BinaryCmd",
  "Redirect",
  "Word",
  "Lit",
  "SglQuoted",
  "DblQuoted",
  "ParamExp",
  "Expansion",
  "Replace",
  "Slice",
]);

/** Readable names for the blocked node types people are likely to hit. */
const NODE_NAMES: Readonly<Record<string, string>> = {
  Assign: "environment assignment",
  CmdSubst: "command substitution $(...)",
  ProcSubst: "process substitution <(...)",
  Subshell: "subshell (...)",
  Block: "command group { ... }",
  FuncDecl: "function definition",
  ArithmExp: "arithmetic expansion $((...))",
  CoprocClause: "coproc",
  TimeClause: "time",
  DeclClause: "variable declaration",
  TestClause: "[[ ... ]] test",
  ArithmCmd: "(( ... )) arithmetic",
  IfClause: "if",
  WhileClause: "while/until loop",
  ForClause: "for loop",
  CaseClause: "case",
  ExtGlob: "extended glob",
};

/**
 * Redirect operators by the parser's numeric enum, verified against the
 * pinned mvdan-sh version by a test. The enum is not exported at runtime.
 */
const REDIR_OPS: Readonly<Record<number, string>> = {
  54: ">",
  55: ">>",
  56: "<",
  57: "<>",
  58: "<&",
  59: ">&",
  60: ">|",
  61: "<<",
  62: "<<-",
  63: "<<<",
  64: "&>",
  65: "&>>",
};

/** Unquoted text of a word made only of literals and quotes, else null. */
function literalText(word: sh.Word | null): string | null {
  if (!word) return null;
  let out = "";
  for (const part of word.Parts) {
    switch (syntax.NodeType(part)) {
      case "Lit":
      case "SglQuoted":
        out += (part as sh.Lit | sh.SglQuoted).Value;
        break;
      case "DblQuoted": {
        for (const inner of (part as sh.DblQuoted).Parts) {
          if (syntax.NodeType(inner) !== "Lit") return null;
          out += (inner as sh.Lit).Value;
        }
        break;
      }
      default:
        return null;
    }
  }
  return out;
}

function parseErrorText(err: unknown): string {
  if (typeof err === "object" && err !== null && "Error" in err) {
    const fn = (err as { Error: unknown }).Error;
    if (typeof fn === "function") return String(fn.call(err)).replace(/^[^:]*:\d+:\d+: /, "");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parse a command line into its simple commands, or explain why its syntax
 * cannot be allowed. Parse errors are refusals too: what we cannot parse we
 * cannot vouch for.
 */
export function parseCommand(cmd: string): ParseResult {
  let file: sh.File;
  try {
    file = syntax.NewParser().Parse(cmd, "command");
  } catch (err) {
    return { ok: false, reason: `Blocked: could not parse command: ${parseErrorText(err)}.` };
  }

  // Go positions are byte offsets, so slice the UTF-8 bytes, not the string.
  const bytes = Buffer.from(cmd, "utf8");
  const source = (node: sh.Node) => bytes.toString("utf8", node.Pos().Offset(), node.End().Offset());
  const wordText = (word: sh.Word) => literalText(word) ?? source(word);

  const commands: SimpleCommand[] = [];
  let problem: string | null = null;

  syntax.Walk(file, (node) => {
    if (!node || problem !== null) return false;
    const type = syntax.NodeType(node);
    if (!ALLOWED_NODES.has(type)) {
      const name =
        type === "CmdSubst" && (node as sh.CmdSubst).Backquotes
          ? "backtick command substitution"
          : (NODE_NAMES[type] ?? `${type} syntax`);
      problem = `Blocked: ${name} is not allowed.`;
      return false;
    }
    if (type !== "Stmt") return true;

    const stmt = node as sh.Stmt;
    if (stmt.Coprocess) {
      problem = "Blocked: coproc is not allowed.";
      return false;
    }
    const words: string[] = [];
    let literalWords = 0;
    const isCall = stmt.Cmd !== null && syntax.NodeType(stmt.Cmd) === "CallExpr";
    if (isCall) {
      const call = stmt.Cmd as sh.CallExpr;
      // Checked here rather than left to the Assign node so the reason can
      // name the variable. Assign is not in ALLOWED_NODES either, so nothing
      // slips through if the parser ever places one elsewhere.
      const assign = call.Assigns.find((a): a is sh.Assign => a !== null);
      if (assign) {
        const name = assign.Name?.Value;
        problem = `Blocked: environment assignment '${name ? `${name}=...` : source(assign)}' is not allowed.`;
        return false;
      }
      const args = call.Args.filter((w): w is sh.Word => w !== null);
      for (const [i, arg] of args.entries()) {
        const literal = literalText(arg);
        if (literal !== null && literalWords === i) literalWords = i + 1;
        // Only a literal program name gets its directory stripped; `$X/ls`
        // must stay as written so it cannot match `ls`.
        words.push(i === 0 && literal !== null ? literal.slice(literal.lastIndexOf("/") + 1) : (literal ?? source(arg)));
      }
    }
    const redirects: Redirect[] = [];
    for (const r of stmt.Redirs) {
      if (!r) continue;
      redirects.push({
        fd: r.N?.Value ?? "",
        op: REDIR_OPS[r.Op] ?? `op#${String(r.Op)}`,
        target: r.Word ? wordText(r.Word) : "",
      });
    }
    // A statement wrapping a pipeline or chain is not a command itself; its
    // parts are visited as their own statements. Redirect-only statements
    // (`> file`) are commands.
    if (isCall || stmt.Cmd === null || redirects.length > 0) {
      commands.push({ words, literalWords, redirects });
    }
    return true;
  });

  return problem !== null ? { ok: false, reason: problem } : { ok: true, commands };
}

const isDigits = (s: string) => /^\d+$/.test(s);

/** Operators that write to their target path. */
const WRITE_OPS: ReadonlySet<string> = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

/**
 * Why a redirection is blocked, or null if it is allowed.
 *
 * Allowed: input (< << <<- <<<), fd duplication (2>&1, >&2, >&-), and any
 * write to /dev/null. Blocked: every other write, including to a target we
 * cannot resolve statically like "$f", and any operator we do not recognise.
 */
export function redirectProblem(r: Redirect): string | null {
  const isDup = r.target === "-" || isDigits(r.target);
  if (r.op === "<" || r.op === "<<" || r.op === "<<-" || r.op === "<<<" || r.op === "<&") return null;
  if (r.op === ">&" && isDup) return null;
  const writes = r.op === ">&" || WRITE_OPS.has(r.op);
  if (writes && r.target === "/dev/null") return null;
  const shown = r.target === "" ? "(missing target)" : `'${r.target}'`;
  return writes
    ? `output redirection to ${shown} is not allowed`
    : `redirection '${r.op}' to ${shown} is not allowed`;
}

/**
 * bashcage's own invocations that run nothing. Always allowed, so an agent
 * can inspect the guard without an allowlist entry. The wrapper form
 * (`bashcage COMMAND`) is deliberately absent: it must be allowlisted like
 * anything else.
 */
export const READONLY_SELF: readonly string[] = [
  "bashcage --list",
  "bashcage -l",
  "bashcage --check",
  "bashcage -c",
  "bashcage --config",
  "bashcage --doctor",
  "bashcage --init",
  "bashcage --pre-tool-hook",
  "bashcage --help",
  "bashcage --version",
];

/** An entry matches when its words equal the command's leading literal words. */
function matchesEntry({ words, literalWords }: SimpleCommand, entry: string): boolean {
  const pattern = entry.trim().split(/\s+/).filter(Boolean);
  if (pattern.length === 0 || literalWords < pattern.length) return false;
  return pattern.every((w, i) => words[i] === w);
}

/** Check a command against an allowlist. */
export function check(cmd: string, allowed: readonly string[]): CheckResult {
  if (typeof cmd !== "string" || !cmd.trim()) return { ok: true };

  const parsed = parseCommand(cmd);
  if (!parsed.ok) return parsed;

  for (const command of parsed.commands) {
    const { words, redirects } = command;
    for (const r of redirects) {
      const problem = redirectProblem(r);
      if (problem) return { ok: false, reason: `Blocked: ${problem}.` };
    }
    if (words.length === 0) continue;
    if (READONLY_SELF.some((entry) => matchesEntry(command, entry))) continue;
    if (!allowed.some((entry) => matchesEntry(command, entry))) {
      return {
        ok: false,
        reason: `Blocked: '${words[0]}' is not allowed. Allowed commands: ${allowed.join(", ")}.`,
      };
    }
  }
  return { ok: true };
}

Set up bashcage in this project. bashcage is an allowlist guard for shell commands: as a Claude Code PreToolUse hook it checks every Bash tool call against the allowlist in `.bashcage.json` and blocks anything not on it (exit 2, reason on stderr) before it runs. Do the steps below in order, then report what you changed.

## 1. Register the hook

Merge this into `.claude/settings.json`, creating the file if it does not exist. Keep everything already in it; if `hooks.PreToolUse` already exists, append the entry to that array rather than replacing it. Use `.claude/settings.local.json` instead only if the user wants this personal rather than shared with the project.

```json
{{hookJson}}
```

The command path may be relative: hooks run from the project directory.

## 2. Write the allowlist

The allowlist is the `allow` array of the nearest `.bashcage.json`, looked up from the project directory upwards; `{{bin}} --config` prints which file is in use, if any. There is no built-in default: with no `.bashcage.json` found, bashcage blocks every command, so this file must exist before the hook lets anything through.

If the project already has one, leave it as it is unless the user asks to change it. Otherwise ask the user which commands they want to allow, then write `.bashcage.json` in the project root, for example:

```json
{ "allow": ["ls", "git status", "git log"] }
```

Entries are command prefixes: `git add` allows `git add -A` but not `git push`. Only the leading words are checked, never the arguments, so keep the list to commands that are safe with any arguments. bashcage's own read-only invocations (`{{bin}} --list`, `{{bin}} --check`, `--config`, `--doctor`, `--help`, ...) are always allowed and need no entry, so you can inspect the guard yourself at any time.

## 3. Tell future sessions

Append this to `CLAUDE.md`, creating the file if needed. Skip it if an equivalent section is already there.

```markdown
## bashcage

Bash tool calls are gated by bashcage against the allowlist in `.bashcage.json`; anything not on it is blocked before it runs. Run `{{bin}} --list` to see the list and `{{bin}} --check '<command>'` to test one. When a command is blocked, ask the user to add an entry to `.bashcage.json` instead of working around the guard.
```

## 4. Verify

Using the Bash tool, actually run:

1. A command that is on the allowlist. It should run normally.
2. `true`, which is harmless and not on the allowlist unless the user added it. The hook should block it with `Blocked: 'true' is not allowed`.

If `true` runs instead of being blocked, Claude Code has not loaded the new settings yet: ask the user to run `/hooks` once or restart Claude Code, then try again. Do not remove or loosen the hook to make the check pass.

Finally, tell the user what you changed and show the active allowlist.

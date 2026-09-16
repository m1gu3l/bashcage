Audit the bashcage allowlist of this project. bashcage is an allowlist guard for shell commands: as a Claude Code PreToolUse hook it checks every Bash tool call against the allowlist and blocks anything not on it before it runs. The guard is only as safe as the list, so go through every entry below, decide whether it is safe to allow, and report what you find. Do not edit any file until the user has agreed to the changes you propose.

## The allowlist under review

{{sourceNote}}

{{allowList}}

## What bashcage checks, and what it does not

Knowing this is the whole point of the audit: bashcage guards the shape of the command, the entries guard its meaning.

- An entry is one or more words. A simple command matches an entry when its leading words equal the entry's words, so `git add` allows `git add -A` but not `git push`, and `git` alone allows every git subcommand. A path prefix on the program is stripped: `/bin/ls` counts as `ls`.
- **Arguments are never checked.** An allowed command may be run with any flags, any paths, and any values. Every entry must therefore be safe with any arguments at all.
- Pipelines and `&& || ; &` chains are fine, but every simple command in them is checked on its own.
- Command substitution (`$(...)`, backticks), process substitution, subshells, command groups, functions, loops, and arithmetic are blocked outright. A program name that needs expansion, like `$X/ls`, never matches an entry.
- Redirections that write to a file other than `/dev/null` are blocked. Input redirections, heredocs, and fd duplications like `2>&1` are allowed.

So you need not worry about a clever shell construct sneaking past the guard. You need to worry about what an allowed program can be made to do through its own arguments.

## Questions to ask of every entry

Judge each entry against all of these. A single yes makes the entry unsafe or at least worth flagging.

1. **Can it write, delete, or change files or permissions?** `rm`, `mv`, `cp`, `tee`, `dd`, `truncate`, `chmod`, `chown`, `ln`, `mkdir`, `touch`, and anything with an in-place edit flag like `sed -i`, `perl -i`, `sort -o`, `gzip`. Remember that the redirection guard does not help here: the program itself does the writing.
2. **Can it run another program?** This is the most common hole, because it lets the whole allowlist be bypassed with one allowed word. Interpreters and shells: `bash`, `sh`, `zsh`, `node`, `python`, `ruby`, `perl`, `awk` (it has `system()`), `eval`, `exec`. Launchers and wrappers: `sudo`, `env`, `xargs`, `time`, `timeout`, `nice`, `nohup`, `watch`, `script`, `npx`, `pnpm exec`, `pnpm dlx`, `bunx`, `uvx`, `make`, `npm run`, `pnpm run`, `yarn`, `cargo run`, `go run`, `docker`, `kubectl`. Escape hatches inside otherwise tame tools: `find -exec` and `-delete`, `git -c core.pager=...`, `git -c alias.x='!cmd'`, `git --exec-path`, `git -c core.sshCommand=...`, `less` and `man` (both can run `!cmd`), `vim`, `sed` with the `e` command (GNU sed), `tar --to-command`, `rsync -e`, `ssh`. `bashcage` itself is the exception: as a wrapper it applies this same allowlist before running anything, so it is safe to allow. Its read-only invocations (`--list`, `--check`, `--config`, `--doctor`, `--help`, ...) are always allowed without an entry, so an entry for them is redundant.
3. **Can it reach the network?** `curl`, `wget`, `nc`, `ssh`, `scp`, `rsync`, `git push`, `git fetch`, `git pull`, `git clone`, `npm publish`, `npm install`, `pip install`, `docker pull`. Sending data out matters as much as pulling code in; an allowed `curl` can exfiltrate anything a read-only command can read.
4. **Is the prefix broader than it needs to be?** A bare `git`, `npm`, `pnpm`, `docker`, `gh`, `kubectl`, or `aws` allows every subcommand, including the ones in the lists above. Prefer the specific subcommands that are actually needed: `git status`, `git diff`, `git log`, `pnpm test`. Check that the fixed prefix cannot itself be undone: `git status` is fine because the subcommand is already chosen, but a `pnpm -r` style entry still takes the subcommand as an argument.
5. **Is it a read-only command with unrestricted reach?** `cat`, `head`, `grep`, `find`, `ls` and friends can read any file the user can, including `~/.ssh`, `.env`, and credential stores. This is normally acceptable and is what the built-in default allows, but say so in the report so the user makes that choice knowingly, and pair it with the answer to question 3: read-only plus network is no longer read-only.
6. **Is it redundant, misspelled, or absent?** An entry shadowed by a shorter one (`git add` next to `git`), a typo that will never match, or a program not installed here. Use `which` to check availability where it matters; a missing program is harmless but probably not what the user meant.

## Verify, do not just reason

Using the Bash tool, run `{{bin}} --check '<command>'` for a few concrete commands to confirm your reading of the list. It exits 0 when the command would be allowed and 2 with the reason on stderr when it would be blocked; nothing is run either way. Try at least:

- One harmless allowed command, which should pass.
- The most dangerous invocation you can build from each entry you consider unsafe, for example `{{bin}} --check 'find . -name x -exec rm {} ;'` for `find`, or `{{bin}} --check 'git -c core.pager=touch\ pwned log'` for a bare `git`. If it passes, the entry really does allow it.
- `{{bin}} --check 'ls $(rm -rf x)'` and `{{bin}} --check 'ls > out.txt'`, which should both be blocked; if either passes, stop and tell the user bashcage itself is misbehaving.

## Report

Give the user one line per entry with a verdict of **safe**, **caution**, or **unsafe** and the reason in a few words, then a short list of proposed changes: entries to remove, entries to narrow to a specific subcommand, and entries to keep despite a caution because the project needs them. Where a broad entry is unsafe, propose the narrowest replacement that still covers what the project appears to use; look at `package.json` scripts, `CLAUDE.md`, and recent shell history in the conversation for hints, and ask when unsure.

Only after the user agrees, edit `.bashcage.json` (creating it in the project root if the built-in default is in use), then run `{{bin}} --list` and show the resulting allowlist.

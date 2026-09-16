## bashcage

Bash tool calls are gated by bashcage against the allowlist in `.bashcage.json`; anything not on it is blocked before it runs. Run `./node_modules/.bin/bashcage --list` to see the list and `./node_modules/.bin/bashcage --check '<command>'` to test one. When a command is blocked, ask the user to add an entry to `.bashcage.json` instead of working around the guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { check, parseCommand } from "../src/check.ts";

const ALLOW = ["cdk", "aws", "curl", "jq"];
const ok = (cmd: string, allow: readonly string[] = ALLOW) =>
  assert.equal(check(cmd, allow).ok, true, cmd);
const blocked = (cmd: string, fragment?: RegExp, allow: readonly string[] = ALLOW) => {
  const r = check(cmd, allow);
  assert.equal(r.ok, false, cmd);
  if (fragment && !r.ok) assert.match(r.reason, fragment);
};
const commands = (cmd: string) => {
  const r = parseCommand(cmd);
  assert.equal(r.ok, true, cmd);
  return r.ok ? r.commands : [];
};

test("allows plain allowlisted commands", () => {
  ok("cdk deploy --all --outputs-file out.json");
  ok("aws sts get-caller-identity");
  ok("curl -s https://example.com");
  ok('jq -r ".MyStack.ApiUrl" out.json');
});

test("allows chains and pipes of allowlisted commands", () => {
  ok("aws sts get-caller-identity && aws configure list");
  ok("curl -s https://example.com | aws s3 cp - s3://b/k");
  ok('aws lambda list-functions | jq -r ".Functions[].FunctionName"');
  ok("cdk synth; cdk diff || cdk list");
  ok("cdk list\naws cloudformation list-stacks");
  ok("aws s3 ls |& jq .");
  ok("! aws s3 ls");
  ok("aws s3 ls &");
});

test("allows env var prefixes and absolute paths", () => {
  ok("AWS_PROFILE=dev cdk diff");
  ok("AWS_PROFILE=dev AWS_REGION=eu-west-1 aws s3 ls");
  ok("/usr/local/bin/aws s3 ls");
});

test("does not split inside quotes", () => {
  ok('aws s3 cp x "s3://bucket/a;b|c"');
  ok("aws ssm put-parameter --value 'x && y'");
  ok("curl -d '{\"a\":\"b;c\"}' https://example.com");
  ok('curl -d "<xml>a > b</xml>" https://example.com');
  ok("jq 'select(.a > 1 and .b < 2)' out.json");
});

test("allows plain expansions and globs in arguments", () => {
  ok("aws s3 ls $BUCKET");
  ok('aws s3 cp "$SRC" s3://b/k');
  ok("aws s3 ls ${BUCKET:-default}");
  ok("jq . *.json ~/x {a,b}.json");
  ok("aws s3 ls # trailing comment");
  ok("aws \\\n  s3 ls");
});

test("multi-word entries match as prefixes", () => {
  const allow = ["git add", "git status", "ls"];
  ok("git add -A", allow);
  ok("git status --short && ls -la", allow);
  ok("GIT_DIR=.git git add .", allow);
  blocked("git push", /'git'/, allow);
  blocked("git add . && git commit -m x", /'git'/, allow);
  blocked("git", /'git'/, allow);
});

test("bashcage's own read-only invocations need no entry", () => {
  ok("bashcage --list", []);
  ok("bashcage -l", []);
  ok("./node_modules/.bin/bashcage --check 'rm -rf /'", []);
  ok("bashcage -c git push", []);
  ok("bashcage --config", []);
  ok("bashcage --doctor", []);
  ok("bashcage --init", []);
  ok("bashcage --pre-tool-hook", []);
  ok("bashcage --help", []);
  ok("bashcage --version", []);
  ok("bashcage --list && aws s3 ls");
  // The wrapper form runs a command, so it is not exempt.
  blocked("bashcage git status", /'bashcage'/, []);
  blocked("bashcage -- --list", /'bashcage'/, []);
  blocked("bashcage", /'bashcage'/, []);
  blocked("$X/bashcage --list", /'\$X\/bashcage'/, []);
  blocked("bashcage --list | tee out.txt", /'tee'/, []);
  blocked("bashcage --list > out.txt", /redirection/, []);
});

test("blocks non-allowlisted commands", () => {
  blocked("npm install", /'npm'/);
  blocked("ls", /'ls'/);
  blocked("cd /tmp && aws s3 ls", /'cd'/);
  blocked("sudo aws s3 ls", /'sudo'/);
  blocked('bash -c "aws s3 ls"', /'bash'/);
});

test("blocks a bad command anywhere in a chain", () => {
  blocked("cdk list; rm -rf /", /'rm'/);
  blocked("aws s3 ls | tee out.txt", /'tee'/);
  blocked('jq -r ".x" out.json | xargs curl', /'xargs'/);
  blocked("aws s3 ls & rm -rf /", /'rm'/);
});

test("blocks a program name that needs expansion", () => {
  blocked("$AWS s3 ls", /'\$AWS'/);
  blocked("$X/aws s3 ls", /'\$X\/aws'/);
  blocked('"$X"/aws s3 ls', /is not allowed/);
  blocked("aws $X", /'aws' is not allowed/, ["aws s3"]);
  blocked("aws $X", /'aws' is not allowed/, ["aws $X"]);
});

test("blocks substitution and grouping tricks", () => {
  blocked("aws s3 ls $(cat secret)", /command substitution/);
  blocked("aws s3 ls `cat secret`", /backtick/);
  blocked('aws s3 ls "$(cat secret)"', /command substitution/);
  blocked("aws s3 ls ${x:-$(cat secret)}", /command substitution/);
  blocked("aws s3 cp <(cat secret) s3://b/k", /process substitution/);
  blocked("(rm -rf /)", /subshell/);
  blocked("{ rm -rf /; }", /command group/);
  blocked("aws s3 ls || { rm -rf /; }", /command group/);
  blocked("x() { rm -rf /; }; x", /function definition/);
  blocked("aws s3 ls $((1+1))", /arithmetic/);
  blocked("for f in *; do rm $f; done", /for loop/);
  blocked("if true; then rm -rf /; fi", /if/);
  blocked("time aws s3 ls", /time/);
  blocked("coproc aws s3 ls", /coproc/);
  blocked("[[ -f x ]]", /test/);
  blocked("declare -a x", /declaration/);
});

test("blocks what it cannot parse", () => {
  blocked("aws s3 ls >", /could not parse/);
  blocked("aws s3 ls (", /could not parse/);
  blocked("aws s3 ls 'unterminated", /could not parse/);
});

test("empty command passes through", () => {
  ok("");
  ok("   ");
});

test("allows harmless redirections", () => {
  ok("aws s3 ls 2>&1");
  ok("aws s3 ls >&2");
  ok("aws s3 ls 2>&-");
  ok("aws s3 ls > /dev/null");
  ok("aws s3 ls >/dev/null 2>&1");
  ok("aws s3 ls &> /dev/null");
  ok("aws s3 ls 2>/dev/null | jq .");
  ok("jq . < out.json");
  ok("jq . <out.json");
  ok("jq . <<< '{\"a\":1}'");
  ok("jq -r .x <<EOF\n{\"x\":1}\nEOF");
  ok("jq -r .x <<EOF\nrm -rf /; not a command\nEOF\ncdk list");
  ok("jq -r .x <<'EOF'\nrm -rf /\nEOF");
  ok("jq -r .x <<-EOF\n\trm -rf /\n\tEOF");
  ok("jq -r .x <<A <<B\nbody a\nA\nrm -rf /\nB\naws s3 ls");
});

test("heredoc bodies still end at their delimiter", () => {
  blocked("jq -r .x <<EOF\nbody\nEOF\nrm -rf /", /'rm'/);
  blocked("jq -r .x <<EOF\nbody\nEOF\n", undefined, ["cdk"]);
});

test("unquoted heredoc bodies are expanded, so substitutions in them are blocked", () => {
  blocked("jq -r .x <<EOF\n$(rm -rf /)\nEOF", /command substitution/);
  ok("jq -r .x <<'EOF'\n$(rm -rf /)\nEOF");
});

test("blocks redirections that write to a path", () => {
  blocked("aws s3 ls > out.txt", /redirection to 'out.txt'/);
  blocked("aws s3 ls>out.txt", /redirection to 'out.txt'/);
  blocked("aws s3 ls >> out.txt", /redirection to 'out.txt'/);
  blocked("aws s3 ls >| out.txt", /redirection to 'out.txt'/);
  blocked("aws s3 ls 2> err.txt", /redirection to 'err.txt'/);
  blocked("aws s3 ls &> all.txt", /redirection to 'all.txt'/);
  blocked("aws s3 ls &>> all.txt", /redirection to 'all.txt'/);
  blocked("aws s3 ls >& all.txt", /redirection to 'all.txt'/);
  blocked("aws s3 ls <> rw.txt", /redirection to 'rw.txt'/);
  blocked("aws s3 ls {fd}> out.txt", /redirection to 'out.txt'/);
  blocked('aws s3 ls > "$f"', /redirection to '"\$f"'/);
  blocked("aws s3 ls > $f", /redirection to '\$f'/);
  blocked("aws s3 ls > '/dev/null '", /redirection/);
  blocked("> /etc/hosts", /redirection to '\/etc\/hosts'/);
  blocked("cdk list; > /etc/hosts", /redirection to '\/etc\/hosts'/);
  blocked("aws s3 ls | jq . > out.json", /redirection to 'out.json'/);
});

test("parseCommand separates words from redirections", () => {
  assert.deepEqual(commands("FOO='a b' ls -la 2>&1 >out <in"), [
    {
      words: ["ls", "-la"],
      literalWords: 2,
      redirects: [
        { fd: "2", op: ">&", target: "1" },
        { fd: "", op: ">", target: "out" },
        { fd: "", op: "<", target: "in" },
      ],
    },
  ]);
  assert.deepEqual(commands("ls 10>x {fd}>y a1>z"), [
    {
      words: ["ls", "a1"],
      literalWords: 2,
      redirects: [
        { fd: "10", op: ">", target: "x" },
        { fd: "{fd}", op: ">", target: "y" },
        { fd: "", op: ">", target: "z" },
      ],
    },
  ]);
  assert.deepEqual(commands("a | b && c || d; e & f").map((c) => c.words), [
    ["a"], ["b"], ["c"], ["d"], ["e"], ["f"],
  ]);
});

test("parseCommand unquotes literal words and strips the program's directory", () => {
  const [cmd] = commands("FOO=1 BAR=2 /usr/bin/aws 's3' \"ls\" $X \"a$X\" more");
  assert.deepEqual(cmd?.words, ["aws", "s3", "ls", "$X", '"a$X"', "more"]);
  assert.equal(cmd?.literalWords, 3);
  assert.deepEqual(commands("FOO=1"), [{ words: [], literalWords: 0, redirects: [] }]);
});

test("parseCommand keeps byte offsets straight in non-ASCII commands", () => {
  // `$X` starts at byte 6 but string index 3; slicing by string index would
  // yield "ls" here and let `$X` match an allowlisted `ls`.
  assert.deepEqual(commands("ééé$X ls")[0]?.words, ["ééé$X", "ls"]);
  blocked("ééé$X ls", /'ééé\$X'/, ["ls"]);
});

test("redirect operator table matches the pinned parser", () => {
  const forms: Array<[string, string]> = [
    ["a >x", ">"], ["a >>x", ">>"], ["a <x", "<"], ["a <>x", "<>"], ["a <&3", "<&"],
    ["a >&3", ">&"], ["a >|x", ">|"], ["a <<E\nb\nE", "<<"], ["a <<-E\nb\nE", "<<-"],
    ["a <<<x", "<<<"], ["a &>x", "&>"], ["a &>>x", "&>>"],
  ];
  for (const [cmd, op] of forms) {
    assert.equal(commands(cmd)[0]?.redirects[0]?.op, op, cmd);
  }
});

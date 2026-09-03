#!/usr/bin/env sh
# Deterministic consistency checks for the current OpenSpec-native workflow.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$HERE/../lib/assert.sh"

WF="$ROOT/WORKFLOW.md"
README="$ROOT/README.md"
README_TH="$ROOT/README.th.md"
AGENT="$ROOT/.claude/harness/AGENT.md"
ORCH="$ROOT/.claude/orchestrator.md"
DECISION_POLICY="$ROOT/.claude/commands/references/decision-policy.md"
COMMANDS="$ROOT/.claude/harness/commands.json"
PROVE="$ROOT/.claude/skills/prove/references/workflow.md"
HOST_CAPABILITIES="$ROOT/.claude/harness/adapters/host-capabilities.json"
HOOKS_README="$ROOT/.claude/hooks/README.md"

ver="$(tr -d ' \t\n\r' < "$ROOT/VERSION")"
assert_file_contains "VERSION is reflected in the workflow" "$WF" "Version $ver"

assert_file_contains "agent contract translates machine handoffs" \
  "$AGENT" "Harness output is a machine handoff"
# The installer's pointer block cites AGENT.md and nothing else, so a decision
# protocol stated there only in prose leaves the tool rule in `fundamentals.md`
# unreachable — and a host offering selectable options gets a paragraph instead.
assert_file_contains "agent contract names the structured question channel" \
  "$AGENT" "AskUserQuestion"
assert_file_contains "agent contract states the plain-text fallback" \
  "$AGENT" "plain text otherwise"
assert_file_contains "agent contract cites fundamentals for conduct" \
  "$AGENT" 'for conduct and skill routing'
assert_file_contains "orchestrator routes structured decisions selectively" \
  "$ORCH" '.claude/commands/references/decision-policy.md'
assert_file_contains "decision policy stops for an explicit user answer" \
  "$DECISION_POLICY" 'an explicit user answer'
assert_file_contains "prove uses the authority request bridge" \
  "$PROVE" '`authority request`'
assert_file_contains "prove forbids raw readiness output" \
  "$PROVE" "Never expose raw readiness JSON"
assert_file_contains "English README keeps harness metadata internal" \
  "$README" "Users never need to construct receipt commands"
assert_file_contains "Thai README keeps harness metadata internal" \
  "$README_TH" "ผู้ใช้ไม่ต้องประกอบ receipt command"
assert_file_contains "English README documents Homebrew installation" \
  "$README" "brew install claude-foundation"
assert_file_contains "Thai README documents Homebrew installation" \
  "$README_TH" "brew install claude-foundation"

assert_file_contains "hook documentation names the canonical host capability contract" \
  "$HOOKS_README" '.claude/harness/adapters/host-capabilities.json'
assert_file_contains "hook documentation separates native dispatch" \
  "$HOOKS_README" 'Native dispatch'
assert_cmd_zero "host capability contract covers every supported host truthfully" \
  node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const expected = ["claude-code", "opencode", "cursor", "codex"];
    const keys = Object.keys(c.hosts || {}).sort();
    const guards = c.hosts || {};
    const ok = c.version === 2 && JSON.stringify(keys) === JSON.stringify(expected.sort()) &&
      expected.every((host) => guards[host].nativeDispatch === "available" &&
        guards[host].finalEnforcement === "Land gates" &&
        guards[host].workflowGuarantees.terminalTruth === "runtime-enforced" &&
        guards[host].workflowGuarantees.staleProof === "runtime-enforced" &&
        guards[host].workflowGuarantees.explicitLand === "runtime-enforced") &&
      guards["claude-code"].liveMutationGuards.coverage === "full" &&
      guards["claude-code"].workflowGuarantees.phaseIsolation === "live-hook-and-runtime" &&
      guards.opencode.liveMutationGuards.coverage === "partial" &&
      guards.opencode.liveMutationGuards.sessionDigest === "unavailable" &&
      guards.opencode.workflowGuarantees.phaseIsolation === "live-plugin-and-runtime" &&
      guards.cursor.liveMutationGuards.coverage === "unavailable" &&
      guards.codex.liveMutationGuards.coverage === "unavailable" &&
      guards.cursor.workflowGuarantees.phaseIsolation === "final-audit-only" &&
      guards.codex.workflowGuarantees.phaseIsolation === "final-audit-only" &&
      guards.cursor.unattendedWrites.mode === "blocked-without-equivalent-boundary" &&
      guards.codex.unattendedWrites.mode === "blocked-without-equivalent-boundary";
    process.exit(ok ? 0 : 1);
  ' "$HOST_CAPABILITIES"
assert_cmd_zero "host wiring table matches the canonical capability rows" \
  node -e '
    const fs = require("fs");
    const [contractPath, docsPath] = process.argv.slice(1);
    const hosts = JSON.parse(fs.readFileSync(contractPath, "utf8")).hosts;
    const docs = fs.readFileSync(docsPath, "utf8");
    const labels = {"claude-code":"Claude Code", opencode:"OpenCode", cursor:"Cursor", codex:"Codex CLI"};
    const ok = Object.entries(hosts).every(([id, row]) => {
      const line = docs.split(/\r?\n/).find((candidate) => candidate.startsWith(`| ${labels[id]} |`));
      const guards = row.liveMutationGuards;
      const detail = `${guards.coverage}: phase ${guards.phase}; secrets ${guards.secrets}; ` +
        `lint ${guards.lint}; session digest ${guards.sessionDigest}`;
      return line && line.includes(`| ${row.nativeDispatch} |`) && line.includes(detail);
    });
    process.exit(ok ? 0 : 1);
  ' "$HOST_CAPABILITIES" "$HOOKS_README"

assert_cmd_zero "command registry has unique public names" \
  jq -e '([.commands[].name] | length) == ([.commands[].name] | unique | length)' \
  "$COMMANDS"
assert_cmd_zero "authority continuations name their decision reference" \
  jq -e '[.commands[] | select(.name == "budget continue" or .name == "land record" or
    .name == "change abandon") |
    (.kind == "authority" and (.usage | contains("--decision-ref")))] | all' \
  "$COMMANDS"
assert_cmd_zero "retiring a change is registered as a runtime command" \
  jq -e '.runtimeCommands | index("abandon") != null' "$COMMANDS"
assert_file_contains "the workflow documents retiring an unprovable change" \
  "$WF" "change abandon <change> --reason <reason> --decision-ref <ref>"
assert_file_contains "the workflow documents where a retired change goes" \
  "$WF" ".foundation/recovery/abandoned/"
assert_file_contains "the workflow documents that stops carry their exits" \
  "$WF" "## Terminal stops"
assert_file_contains "the workflow makes deterministic recovery agent-owned" \
  "$WF" '`automaticRecovery` is performed'
assert_file_contains "the workflow keeps routine commands away from users" \
  "$WF" "never asks the user to run a safe authorized operation"
assert_file_contains "change offers retiring rather than deciding it" \
  "$ROOT/.claude/skills/change/references/workflow.md" "never retire one unasked"
assert_file_contains "the selective policy treats a blocked stop as a user decision" \
  "$DECISION_POLICY" "including one emitted by a blocked operation"

runtime_api="$(jq -r '.runtimeApi' "$ROOT/.claude/harness/protocol.json")"
cli_api="$(sed -n 's/^EXPECTED_RUNTIME_API=//p' "$ROOT/cli.sh")"
assert_eq "CLI and installed runtime API agree" "$runtime_api" "$cli_api"

if grep -qE 'evidence record .* pass|--decision accept|--unresolved-blockers 0' \
    "$ROOT/.claude/harness/runtime/evidence/proof-readiness.mjs"; then
  fail "proof recovery still embeds a preselected passing decision"
else
  pass "proof recovery contains no preselected passing decision"
fi

# Shipped rules must not point at maintainer-only tests or research paths, nor
# at repository-only files that never reach a consumer's project. The file list
# is every shipped documentation surface — the harness README, the hooks, and
# settings.json were absent before, which is where the escapes were.
SHIPPED_DOCS="$ROOT/.claude/orchestrator.md $ROOT/.claude/commands
$ROOT/.claude/harness/AGENT.md $ROOT/.claude/harness/EVIDENCE.md
$ROOT/.claude/harness/README.md $ROOT/.claude/harness/CONSUMER-QUALITY.md
$ROOT/.claude/hooks $ROOT/.claude/settings.json
$ROOT/.claude/rules $ROOT/.claude/skills $ROOT/WORKFLOW.md"
# Only unambiguous repository-only filenames. Bare directory words like
# "dashboard/" appear as ordinary content in the UI skill's data and would be
# false positives; WORKFLOW.md's `/path/to/claude-foundation/cli.sh` is a
# documented source-checkout escape hatch, not a shipped-path claim.
# shellcheck disable=SC2086 -- intentional word-splitting over the path list
leaks="$(grep -rlE '\.claude/tests|tests/bench|docs/research|install\.sh|install-(cursor|opencode|codex)\.sh|RELEASING\.md|Formula/claude-foundation|release-notes/' \
  $SHIPPED_DOCS 2>/dev/null || true)"
if [ -z "$leaks" ]; then
  pass "shipped workflow files do not cite maintainer-only paths"
else
  fail "shipped workflow files cite maintainer-only paths: $(printf '%s' "$leaks" | tr '\n' ' ')"
fi

# A shipped file that names a relative path must name one that ships.
missing=""
for rel in $(grep -rhoE '(\.\./)?(runtime|skills|rules|commands|hooks|harness)/[A-Za-z0-9._/-]+\.(mjs|md|json)' \
    $SHIPPED_DOCS 2>/dev/null | sort -u); do
  case "$rel" in ../*) candidate="$ROOT/.claude/${rel#../}" ;; *) candidate="$ROOT/.claude/$rel" ;; esac
  [ -e "$candidate" ] || [ -e "$ROOT/.claude/harness/$rel" ] || missing="$missing $rel"
done
if [ -z "$missing" ]; then
  pass "shipped files reference only paths that resolve"
else
  fail "shipped files reference non-resolving paths:$missing"
fi

# --- Documentation tracks the release and the runtime ------------------------
# WORKFLOW.md carried the only version assertion in this suite, which is exactly
# why it stayed current while every unguarded surface drifted four releases. The
# expected values below are read from VERSION, protocol.json, and the runtime
# source at run time rather than written here, so a release either updates the
# documentation or fails this suite. An assertion holding a literal release
# number would reproduce the same drift one release later.

runtime_ver="$(jq -r '.runtime' "$ROOT/.claude/harness/protocol.json")"
SITE="$ROOT/website/index.html"
DOCS="$ROOT/website/docs/src/content/docs"
HARNESS_README="$ROOT/.claude/harness/README.md"

assert_file_contains "English README states the release" "$README" "Version $ver"
assert_file_contains "Thai README states the release" "$README_TH" "Version $ver"
assert_file_contains "the landing page states the release" "$SITE" "<b>v$ver</b>"
assert_file_contains "the landing page states the runtime API" \
  "$SITE" "runtime API $runtime_api"
assert_file_contains "the landing page console shows the runtime API" \
  "$SITE" "class=\"console-api\">API $runtime_api<"
assert_file_contains "the English docs index states the release" \
  "$DOCS/index.md" "**v$ver**"
assert_file_contains "the Thai docs index states the release" \
  "$DOCS/th/index.md" "**v$ver**"
assert_file_contains "the English CLI page pins the release" \
  "$DOCS/cli.md" "| Pin | v$ver |"
assert_file_contains "the Thai CLI page pins the release" \
  "$DOCS/th/cli.md" "| Pin | v$ver |"
assert_file_contains "the English CLI page pins the runtime" \
  "$DOCS/cli.md" "| runtime | $runtime_ver |"
assert_file_contains "the Thai CLI page pins the runtime" \
  "$DOCS/th/cli.md" "| runtime | $runtime_ver |"
assert_file_contains "the English CLI page pins the runtime API" \
  "$DOCS/cli.md" "| runtime API | $runtime_api |"
assert_file_contains "the Thai CLI page pins the runtime API" \
  "$DOCS/th/cli.md" "| runtime API | $runtime_api |"

provider_protocol="$(jq -r '.providerProtocol' \
  "$ROOT/.claude/harness/protocol.json")"
packet_schema="$(jq -r '.packetSchema' "$ROOT/.claude/harness/protocol.json")"
proof_protocol="$(jq -r '.proofProtocol' "$ROOT/.claude/harness/protocol.json")"
semantic_acceptance_protocol="$(jq -r '.semanticAcceptanceProtocol' \
  "$ROOT/.claude/harness/protocol.json")"
semantic_draft_schema="$(jq -r '.semanticDraftSchema' \
  "$ROOT/.claude/harness/protocol.json")"
semantic_amendment_schema="$(jq -r '.semanticAmendmentSchema' \
  "$ROOT/.claude/harness/protocol.json")"
artifact_defaults_schema="$(jq -r '.artifactDefaultsSchema' \
  "$ROOT/.claude/harness/protocol.json")"
grounding_schema="$(jq -r '.groundingSchema | join(", ")' \
  "$ROOT/.claude/harness/protocol.json")"
advance_protocol="$(jq -r '.advanceProtocol' \
  "$ROOT/.claude/harness/protocol.json")"
for page in "$DOCS/cli.md" "$DOCS/th/cli.md"; do
  label="$(basename "$(dirname "$page")")"
  assert_file_contains "$label CLI pins provider protocol" \
    "$page" "| provider protocol | $provider_protocol |"
  assert_file_contains "$label CLI pins packet schema" \
    "$page" "| packet schema | $packet_schema |"
  assert_file_contains "$label CLI pins proof protocol" \
    "$page" "| proof protocol | $proof_protocol |"
  assert_file_contains "$label CLI pins semantic acceptance protocol" \
    "$page" "| semantic acceptance protocol | $semantic_acceptance_protocol |"
  assert_file_contains "$label CLI pins semantic draft schema" \
    "$page" "| semantic draft schema | $semantic_draft_schema |"
  assert_file_contains "$label CLI pins semantic amendment schema" \
    "$page" "| semantic amendment schema | $semantic_amendment_schema |"
  assert_file_contains "$label CLI pins artifact defaults schema" \
    "$page" "| artifact defaults schema | $artifact_defaults_schema |"
  assert_file_contains "$label CLI pins grounding schema" \
    "$page" "| grounding schema | $grounding_schema |"
  assert_file_contains "$label CLI pins advance protocol" \
    "$page" "| advance protocol | $advance_protocol |"
done
assert_file_contains "English loop documents convergent gates" \
  "$DOCS/loop.md" "## How every gate converges"
assert_file_contains "Thai loop documents convergent gates" \
  "$DOCS/th/loop.md" "## ทุก gate เดินจนจบอย่างไร"
assert_file_contains "English install guide documents Homebrew" \
  "$DOCS/install.md" "brew install claude-foundation"
assert_file_contains "Thai install guide documents Homebrew" \
  "$DOCS/th/install.md" "brew install claude-foundation"
assert_file_contains "English install guide requires committing setup before work" \
  "$DOCS/install.md" "## Commit the installation"
assert_file_contains "Thai install guide requires committing setup before work" \
  "$DOCS/th/install.md" "## Commit การติดตั้ง"
assert_file_contains "English install guide leads into the first change" \
  "$DOCS/install.md" "## Start your first change"
assert_file_contains "Thai install guide leads into the first change" \
  "$DOCS/th/install.md" "## เริ่ม change แรก"
assert_file_contains "English Land docs preserve unavailable cost" \
  "$DOCS/loop/land.md" 'cost stays `null`'
assert_file_contains "Thai Land docs preserve unavailable cost" \
  "$DOCS/th/loop/land.md" 'cost เป็น `null`'

assert_cmd_zero "repository default keeps grounding conditional" \
  jq -e '.workflow.grounding == "optional"' "$ROOT/foundation.json"
assert_file_contains "English README makes compiled OpenSpec authoritative" \
  "$README" "OpenSpec packet—not chat or the temporary draft—is the source of truth"
assert_file_contains "Thai README makes compiled OpenSpec authoritative" \
  "$README_TH" "คือ source of truth"
assert_file_contains "English change docs require integration success scenarios" \
  "$DOCS/loop/change.md" '"kind": "success"'
assert_file_contains "English change docs require integration failure scenarios" \
  "$DOCS/loop/change.md" '"kind": "failure"'
assert_file_contains "Thai change docs require integration success scenarios" \
  "$DOCS/th/loop/change.md" '"kind": "success"'
assert_file_contains "Thai change docs require integration failure scenarios" \
  "$DOCS/th/loop/change.md" '"kind": "failure"'
assert_file_contains "English artifacts document conditional execution wiring" \
  "$DOCS/artifacts.md" 'conditional when derived wiring is insufficient'
assert_file_contains "Thai artifacts document conditional execution wiring" \
  "$DOCS/th/artifacts.md" 'มีเมื่อ derived wiring ไม่พอ'
assert_file_contains "English Build continues through one coordinator" \
  "$DOCS/loop/build.md" 'advance <change> --through build'
assert_file_contains "Thai Build continues through one coordinator" \
  "$DOCS/th/loop/build.md" 'advance <change> --through build'
assert_file_contains "English Prove continues through one coordinator" \
  "$DOCS/loop/prove.md" 'advance <change> --through proven'
assert_file_contains "Thai Prove continues through one coordinator" \
  "$DOCS/th/loop/prove.md" 'advance <change> --through proven'
assert_file_contains "English Land continues through one coordinator" \
  "$DOCS/loop/land.md" 'advance <change> --through archived'
assert_file_contains "Thai Land continues through one coordinator" \
  "$DOCS/th/loop/land.md" 'advance <change> --through archived'
assert_file_contains "landing demonstrates unified lifecycle advance" \
  "$SITE" 'claude-foundation advance profile-auth --through proven'

quality_capabilities_protocol="$(jq -r '.qualityCapabilitiesProtocol' \
  "$ROOT/.claude/harness/protocol.json")"
crap_protocol="$(jq -r '.crapProtocol' "$ROOT/.claude/harness/protocol.json")"
automated_mutation_protocol="$(jq -r '.automatedMutationProtocol' \
  "$ROOT/.claude/harness/protocol.json")"
for page in "$DOCS/cli.md" "$DOCS/th/cli.md"; do
  assert_file_contains "$(basename "$(dirname "$page")") CLI pins quality capabilities protocol" \
    "$page" "| quality capabilities protocol | $quality_capabilities_protocol |"
  assert_file_contains "$(basename "$(dirname "$page")") CLI pins CRAP protocol" \
    "$page" "| CRAP protocol | $crap_protocol |"
  assert_file_contains "$(basename "$(dirname "$page")") CLI pins automated mutation protocol" \
    "$page" "| automated mutation protocol | $automated_mutation_protocol |"
done
assert_file_contains "English consumer quality docs forbid scope expansion" \
  "$DOCS/consumer-quality.md" "Quality findings are evidence, not permission to edit"
assert_file_contains "Thai consumer quality docs forbid scope expansion" \
  "$DOCS/th/consumer-quality.md" "Quality finding เป็นหลักฐาน ไม่ใช่อำนาจแก้ code"
assert_file_contains "installed consumer quality guide documents report-only default" \
  "$ROOT/.claude/harness/CONSUMER-QUALITY.md" "report-only by default"

# Every adapter the runtime implements must appear in the shipped operator
# guide. Deriving the set from the provider catalog turns "contract-digest is missing
# from the table" from something a reader has to notice into a failing test.
adapters="$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");
const m=s.match(/const ADAPTERS = new Set\(\[([\s\S]*?)\]\)/);
process.stdout.write(m ? m[1].replace(/["\s]/g,"").split(",").filter(Boolean).join(" ") : "");' \
  "$ROOT/.claude/harness/runtime/evidence/provider-catalog.mjs")"
# Match the table row, not the bare name: prose elsewhere in the file mentions
# individual adapters, so a name-anywhere check passes even when the table that
# readers actually consult has lost its row.
missing_adapters=""
for adapter in $adapters; do
  grep -qF "| \`$adapter\` |" "$HARNESS_README" || missing_adapters="$missing_adapters $adapter"
done
if [ -n "$adapters" ] && [ -z "$missing_adapters" ]; then
  pass "shipped operator guide documents every runtime adapter"
else
  fail "shipped operator guide omits adapters:$missing_adapters"
fi

# The runtime's own state roots are the authority on what the system writes.
# Four listings previously disagreed with each other and with disk, and the one
# most readers reach for omitted the evidence vault.
roots="$(grep -rhoE '"\.foundation", *"[a-z-]+"' \
  "$ROOT/.claude/harness/foundation.mjs" "$ROOT/.claude/harness/runtime" \
  | sed -E 's/.*"\.foundation", *"([a-z-]+)"/\1/' | sort -u)"
undocumented=""
for root in $roots; do
  grep -qF ".foundation/$root/" "$HARNESS_README" || undocumented="$undocumented $root"
done
if [ -n "$roots" ] && [ -z "$undocumented" ]; then
  pass "the canonical artifact table names every runtime state root"
else
  fail "the canonical artifact table omits state roots:$undocumented"
fi

invented=""
for named in $(grep -oE '\.foundation/[a-z-]+/' "$WF" \
    | sed -E 's|\.foundation/([a-z-]+)/|\1|' | sort -u); do
  printf '%s\n' "$roots" | grep -qx "$named" || invented="$invented $named"
done
if [ -z "$invented" ]; then
  pass "the workflow names only state roots the runtime declares"
else
  fail "the workflow names directories the runtime never creates:$invented"
fi

assert_file_contains "the workflow names where the canonical table lives" \
  "$WF" ".claude/harness/README.md"

# --- The documentation site covers what a reader needs -----------------------
# Starlight falls back to the default locale for a missing translation, which
# strands a Thai reader on an English page instead of failing the build. The
# sidebar is the declaration of intent, so it is what gets checked.
sidebar_slugs="$(grep -oE 'slug: "[a-z0-9/-]+"' "$ROOT/website/docs/astro.config.mjs" \
  | sed -E 's|slug: "([a-z0-9/-]+)"|\1|' | sort -u)"
unpaired=""
for slug in $sidebar_slugs; do
  [ -f "$DOCS/$slug.md" ] || unpaired="$unpaired en:$slug"
  [ -f "$DOCS/th/$slug.md" ] || unpaired="$unpaired th:$slug"
done
if [ -n "$sidebar_slugs" ] && [ -z "$unpaired" ]; then
  pass "every page in the sidebar exists in both locales"
else
  fail "sidebar pages missing a locale:$unpaired"
fi

APPROVAL="$DOCS/approval.md"
ARTIFACTS="$DOCS/artifacts.md"
RECEIPTS="$DOCS/evidence/receipts.md"

assert_file_contains "the approval page covers acceptance" "$APPROVAL" "## Acceptance"
assert_file_contains "the approval page covers independent review" \
  "$APPROVAL" "## Independent review"
assert_file_contains "the approval page covers the authority bridge" \
  "$APPROVAL" "## The authority bridge"
assert_file_contains "the approval page covers host attestation" \
  "$APPROVAL" "## Host attestation"
assert_file_contains "the approval page names the blocker a user hits first" \
  "$APPROVAL" "undecided blocks"
assert_file_contains "the approval page names the command that blocks" \
  "$APPROVAL" "change validate"
assert_file_contains "the English README documents acceptance" \
  "$README" "--acceptance-required"
assert_file_contains "the Thai README documents acceptance" \
  "$README_TH" "--acceptance-required"
assert_file_contains "the English README names the seeded independence waiver" \
  "$README" 'independence: "self"'
assert_file_contains "the English README names the seeded diversity waiver" \
  "$README" 'diversity: "single-model"'
assert_file_contains "the English README separates risk routing from assurance" \
  "$README" "does not restore reviewer independence or model diversity"
assert_file_contains "the Thai README names the seeded independence waiver" \
  "$README_TH" 'independence: "self"'
assert_file_contains "the Thai README names the seeded diversity waiver" \
  "$README_TH" 'diversity: "single-model"'
assert_file_contains "the Thai README separates risk routing from assurance" \
  "$README_TH" \
  "ไม่ได้ทำให้ reviewer กลับมาเป็นอิสระหรือทำให้เกิด model diversity"
assert_file_contains "the evidence contract names the selected reviewer" \
  "$ROOT/.claude/harness/EVIDENCE.md" "Claude Code Opus is the selected reviewer"
assert_file_contains "the evidence contract separates routing from assurance" \
  "$ROOT/.claude/harness/EVIDENCE.md" \
  "risk-tiered routing does not restore either assurance axis"

assert_file_contains "the artifacts page names the sole ledger" \
  "$ARTIFACTS" "sole implementation ledger"
assert_file_contains "the artifacts page documents the evidence vault" \
  "$ARTIFACTS" "## The evidence vault"
assert_file_contains "the artifacts page rules prototypes out as evidence" \
  "$ARTIFACTS" "rejected as evidence"

# The page claims to cover every artifact, so the openspec/ tree itself has to
# be on it — the first version documented the packet's files while never saying
# what config.yaml, schemas/, or foundation.json are. Ownership is the load
# bearing part: schemas/ is overwritten on every install and the rest is not.
for entry in "config.yaml" "repositories.yaml" "schemas/" "investigations/" "foundation.json"; do
  assert_file_contains "the artifacts page names $entry" "$ARTIFACTS" "$entry"
done
assert_file_contains "the artifacts page states what an install overwrites" \
  "$ARTIFACTS" "Overwritten every install"
assert_file_contains "the artifacts page separates the two repositories.yaml files" \
  "$ARTIFACTS" "Two files named"

assert_file_contains "the receipts page names the blocking status" \
  "$RECEIPTS" "inconclusive"
assert_file_contains "the receipts page documents the execution floor" \
  "$RECEIPTS" "execution: \"manual\""

# Land refuses on evidence, not on consent. Documenting a guarantee the harness
# does not make is worse than documenting none, so the overclaim is a failure
# rather than a matter of taste.
overclaims="$(grep -rlE 'Land (requires|needs|is gated on|is blocked until)[^.]{0,24}(approval|consent)' \
  "$DOCS" "$README" "$README_TH" "$SITE" 2>/dev/null || true)"
if [ -z "$overclaims" ]; then
  pass "no documentation surface claims Land is gated on consent"
else
  fail "documentation claims Land is gated on consent: $(printf '%s' "$overclaims" | tr '\n' ' ')"
fi
assert_file_contains "the approval page says what Land actually gates on" \
  "$APPROVAL" "Land gates on **evidence**, not on consent"

finish "doc-consistency tests"

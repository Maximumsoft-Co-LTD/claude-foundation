# Multi-repository topology, evidence identity, and ordered Land contracts.
# A superproject fixture proves that topology discovery, worktree fan-out,
# repository packets, model routing, and receipt invalidation share one
# composite control-plane identity without invalidating unrelated repo proof.
for child in api app; do
  mkdir -p "$TMP/$child"
  cd "$TMP/$child"
  git init -q
  git config user.name "Foundation Test"
  git config user.email "foundation@example.invalid"
  printf '%s\n' "$child-before" > "$child.txt"
  git add .
  git commit -qm "$child fixture"
done
mkdir -p "$TMP/multi-project/.claude/harness" "$TMP/multi-project/openspec" \
  "$TMP/multi-project/.foundation"
install_harness_fixture "$ROOT" "$TMP/multi-project"
cp "$ROOT/.claude/harness/commands.json" "$TMP/multi-project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/multi-project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/multi-project/openspec/"
cp "$ROOT/openspec/repositories.yaml" "$TMP/multi-project/openspec/"
cp "$ROOT/foundation.json" "$TMP/multi-project/"
# This fixture exercises the pre-v3.3 multi-repository contract. New
# risk-tiered/grounding behavior has dedicated tests and must not make this
# compatibility case fabricate a Decision Sheet.
jq '.workflow.grounding = "optional" |
    .workflow.reviewPolicy = "legacy" |
    .workflow.reviewCircuit = "legacy"' \
  "$TMP/multi-project/foundation.json" > "$TMP/multi-foundation.json"
mv "$TMP/multi-foundation.json" "$TMP/multi-project/foundation.json"
cp "$ROOT/.foundation/.gitignore" "$TMP/multi-project/.foundation/"
cd "$TMP/multi-project"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git -c protocol.file.allow=always submodule add -q "$TMP/api" api
git -c protocol.file.allow=always submodule add -q "$TMP/app" app
git add .
git commit -qm "multi fixture"
repos="$(node .claude/harness/foundation.mjs repos)"
assert_contains "repository topology discovers API submodule" "$repos" "api	submodule	api"
assert_contains "repository topology discovers app submodule" "$repos" "app	submodule	app"
node .claude/harness/foundation.mjs new 'Cross repository profile' >/dev/null
node .claude/harness/foundation.mjs resolve cross-repository-profile \
  --impact medium --coupling coupled --acceptance-not-required >/dev/null
printf '%s\n' \
  '{"version":1,"repositories":[' \
  '  {"id":"api","mode":"write","dependsOn":[]},' \
  '  {"id":"app","mode":"write","dependsOn":["api"]}' \
  ']}' > openspec/changes/cross-repository-profile/repositories.yaml
printf '%s\n' \
  '# Tasks' \
  '' \
  '- [ ] **T001** Inventory API [repo:api] [kind:inventory] [paths:api.txt]' \
  '- [ ] **T002** Implement API [repo:api] [kind:implementation] [depends:T001] [paths:api.txt,contract.json]' \
  '- [ ] **T003** Implement App [repo:app] [kind:implementation] [paths:app.txt]' \
  '- [ ] **T004** Review contract [repo:app] [kind:contract] [depends:T002,T003] [paths:contract.json]' \
  > openspec/changes/cross-repository-profile/tasks.md
printf '%s\n' \
  '{"version":2,"claims":[' \
  ' {"id":"api-static","scenario":"API remains statically valid","impact":"medium","capabilities":["static-analysis"],"repositories":["api"]},' \
  ' {"id":"profile-contract","scenario":"API and App agree","impact":"medium","capabilities":["cross-repo-contract"],"repositories":["api","app"]}' \
  ']}' > openspec/changes/cross-repository-profile/evidence.yaml
printf '%s\n' \
  '{"version":1,"providers":{' \
  ' "api-static":{"capability":"static-analysis","adapter":"external","repository":"api"},' \
  ' "cross-repo-contract":{"adapter":"contract-digest","contract":{"api":"contract.json","app":"contract.json"}},' \
  ' "review":{"adapter":"external"}' \
  '},"services":{}}' > openspec/changes/cross-repository-profile/execution.yaml
assert_cmd_zero "multi-repository change validates" \
  node .claude/harness/foundation.mjs validate cross-repository-profile
assert_cmd_zero "multi-repository sandboxes fan out" \
  node .claude/harness/foundation.mjs sandbox create cross-repository-profile --all
assert_file_exists "API worktree created" \
  .foundation/repository-sandboxes/cross-repository-profile/api/api.txt
assert_file_exists "app worktree created" \
  .foundation/repository-sandboxes/cross-repository-profile/app/app.txt
printf 'unauthorized\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/app/rogue.txt
surface_output="$(node .claude/harness/foundation.mjs proof-preflight \
  cross-repository-profile 2>&1 || true)"
assert_contains "changed-surface authority rejects undeclared paths" \
  "$surface_output" "changed outside task paths: rogue.txt"
rm .foundation/repository-sandboxes/cross-repository-profile/app/rogue.txt
printf 'committed unauthorized\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/app/rogue.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app add rogue.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  -c user.name="Foundation Test" -c user.email="foundation@example.invalid" \
  commit -qm "committed unauthorized path"
surface_output="$(node .claude/harness/foundation.mjs proof-preflight \
  cross-repository-profile 2>&1 || true)"
assert_contains "committed changed-surface authority rejects undeclared paths" \
  "$surface_output" "changed outside task paths: rogue.txt"
git -C .foundation/repository-sandboxes/cross-repository-profile/app rm -q rogue.txt
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  -c user.name="Foundation Test" -c user.email="foundation@example.invalid" \
  commit -qm "remove unauthorized path"
api_packet="$(node .claude/harness/foundation.mjs packet cross-repository-profile --repo api)"
assert_contains "repo packet selects API" "$api_packet" '"id":"api"'
assert_contains "repo packet includes API task" "$api_packet" '"id":"T001"'
if printf '%s' "$api_packet" | grep -qF '"id":"T003"'; then
  fail "repo packet excludes app task"
else
  pass "repo packet excludes app task"
fi
agent_plan="$(node .claude/harness/foundation.mjs agent-plan cross-repository-profile)"
assert_contains "agent plan is summary-first" "$agent_plan" '"modelCounts":'
if printf '%s' "$agent_plan" | grep -qF '"text":'; then
  fail "agent plan summary excludes full task text"
else
  pass "agent plan summary excludes full task text"
fi
if [ "$(printf '%s' "$agent_plan" | wc -c | tr -d ' ')" -le 4096 ]; then
  pass "agent plan summary stays within 4 KiB"
else
  fail "agent plan summary stays within 4 KiB"
fi
agent_task="$(node .claude/harness/foundation.mjs agent-task \
  cross-repository-profile T001)"
assert_contains "inventory task packet routes to Haiku tier" \
  "$agent_task" '"family":"haiku"'
if printf '%s' "$agent_task" | grep -qF '"id":"T003"'; then
  fail "task packet excludes unrelated tasks"
else
  pass "task packet excludes unrelated tasks"
fi
agent_task="$(node .claude/harness/foundation.mjs agent-task \
  cross-repository-profile T002)"
assert_contains "implementation task packet routes to Sonnet tier" \
  "$agent_task" '"family":"sonnet"'
agent_task="$(node .claude/harness/foundation.mjs agent-task \
  cross-repository-profile T004)"
assert_contains "contract task packet routes to Opus tier" \
  "$agent_task" '"family":"opus"'
assert_cmd_zero "task resource lease is acquired atomically" \
  node .claude/harness/foundation.mjs agent-acquire \
  cross-repository-profile T001 --owner agent-a
if node .claude/harness/foundation.mjs agent-acquire \
  cross-repository-profile T001 --owner agent-b >/dev/null 2>&1; then
  fail "task resource lease blocks a competing agent"
else
  pass "task resource lease blocks a competing agent"
fi
assert_cmd_zero "task resource lease releases by owner" \
  node .claude/harness/foundation.mjs agent-release \
  cross-repository-profile T001 --owner agent-a
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  api-static pass --observed "API static fixture passed" \
  --source harness-test --artifact api.txt >/dev/null
printf 'app-after\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/app/app.txt
scoped_plan="$(node .claude/harness/foundation.mjs proof-plan cross-repository-profile)"
assert_contains "unrelated repo edit preserves API receipt" \
  "$scoped_plan" "api-static: valid"
printf 'api-after\n' > \
  .foundation/repository-sandboxes/cross-repository-profile/api/api.txt
scoped_plan="$(node .claude/harness/foundation.mjs proof-plan cross-repository-profile)"
assert_contains "owning repo edit invalidates API receipt" \
  "$scoped_plan" "api-static: stale"
multi_review_packet="$(node .claude/harness/foundation.mjs packet \
  cross-repository-profile --phase review)"
assert_contains "review packet includes API repository changes" \
  "$multi_review_packet" 'api/api.txt'
assert_contains "review packet includes app repository changes" \
  "$multi_review_packet" 'app/app.txt'
land_plan="$(node .claude/harness/foundation.mjs land-plan cross-repository-profile)"
assert_contains "multi-repo Land is an honest saga" \
  "$land_plan" '"strategy": "ordered-resumable-saga"'
assert_contains "uncommitted child blocks Land" \
  "$land_plan" '"status": "awaiting-explicit-commit"'
sandboxes=.foundation/repository-sandboxes/cross-repository-profile
printf '{"profile":"v1"}\n' > "$sandboxes/api/contract.json"
printf '{"profile":"v1"}\n' > "$sandboxes/app/contract.json"
git -C .foundation/repository-sandboxes/cross-repository-profile/api \
  add api.txt contract.json
git -C .foundation/repository-sandboxes/cross-repository-profile/api \
  -c user.name="Foundation Test" \
  -c user.email="foundation@example.invalid" \
  commit -qm "api profile"
api_commit="$(git -C .foundation/repository-sandboxes/cross-repository-profile/api rev-parse HEAD)"
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  add app.txt contract.json
git -C .foundation/repository-sandboxes/cross-repository-profile/app \
  -c user.name="Foundation Test" \
  -c user.email="foundation@example.invalid" \
  commit -qm "app profile"
app_commit="$(git -C .foundation/repository-sandboxes/cross-repository-profile/app rev-parse HEAD)"
committed_review_packet="$(node .claude/harness/foundation.mjs packet \
  cross-repository-profile --phase review)"
assert_contains "review packet retains committed API changes" \
  "$committed_review_packet" 'api/api.txt'
assert_contains "review packet retains committed app changes" \
  "$committed_review_packet" 'app/app.txt'
printf '%s' "$committed_review_packet" > "$TMP/committed-review-packet.json"
assert_cmd_zero "review packet exposes executable API inspection metadata" \
  jq -e --arg base "$(jq -r '.repositories.api.baseHead' \
    .foundation/runtime/cross-repository-profile.json)" \
    '.changedSurface.inspection[] |
      select(.repositoryId == "api" and .baseHead == $base) |
      .paths | index("api.txt") != null' \
    "$TMP/committed-review-packet.json"
assert_cmd_zero "review packet names the API sandbox workspace" \
  jq -e --arg workspace "$(jq -r '.repositories.api.path' \
    .foundation/runtime/cross-repository-profile.json)" \
    '.changedSurface.inspection[] |
      select(.repositoryId == "api" and .workspacePath == $workspace)' \
    "$TMP/committed-review-packet.json"
assert_cmd_zero "review decision artifacts expose their readable workspace" \
  jq -e '.contractWorkspacePath and
    .decisions.proposal.relativePath == "proposal.md" and
    .decisions.design.relativePath == "design.md" and
    .decisions.specs.relativePath == "specs"' \
    "$TMP/committed-review-packet.json"
assert_cmd_zero "review packet exposes executable app inspection metadata" \
  jq -e --arg base "$(jq -r '.repositories.app.baseHead' \
    .foundation/runtime/cross-repository-profile.json)" \
    '.changedSurface.inspection[] |
      select(.repositoryId == "app" and .baseHead == $base) |
      .paths | index("app.txt") != null' \
    "$TMP/committed-review-packet.json"
sed -i.bak 's/- \[ \]/- [x]/g' \
  .foundation/sandboxes/cross-repository-profile/openspec/changes/cross-repository-profile/tasks.md
rm .foundation/sandboxes/cross-repository-profile/openspec/changes/cross-repository-profile/tasks.md.bak
# The cross-repository contract is checked by hashing the same declared
# artifact on both sides. Asserting agreement in a receipt proves nothing.
printf '{"profile":"v2"}\n' > "$sandboxes/app/contract.json"
contract_mismatch="$(node .claude/harness/foundation.mjs proof-collect \
  cross-repository-profile 2>&1 || true)"
assert_contains "a disagreeing cross-repository contract blocks collection" \
  "$contract_mismatch" "cross-repo-contract:fail"
assert_cmd_zero "a disagreeing contract records why it disagreed" \
  jq -e '.status == "fail" and (.observed | test("contract digests disagree"))' \
  .foundation/receipts/cross-repository-profile/cross-repo-contract.json
assert_cmd_fails_with "a disagreeing contract cannot be asserted past by hand" \
  "must come from an execution" \
  node .claude/harness/foundation.mjs receipt cross-repository-profile \
    cross-repo-contract pass --observed "trust me" --source harness-test \
    --reference "fixture://cross-repo-contract"
git -C "$sandboxes/app" checkout -- contract.json
node .claude/harness/foundation.mjs proof-collect cross-repository-profile >/dev/null 2>&1 || true
assert_cmd_zero "an agreeing cross-repository contract is verified by digest" \
  jq -e '.status == "pass" and (.observed | test("contract digest .* agrees"))' \
  .foundation/receipts/cross-repository-profile/cross-repo-contract.json
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  api-static pass --observed "API static fixture passed" \
  --source harness-test --artifact api.txt >/dev/null
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  compatibility pass --observed "contract change is backward compatible" \
  --source harness-test --reference https://example.invalid/compat-review >/dev/null
node .claude/harness/foundation.mjs receipt cross-repository-profile \
review pass --observed "fixture review found no blockers" \
  --reviewer harness-test --subject-actor implementation-agent \
  --unresolved-blockers 0 \
  --reference "fixture://review" >/dev/null
assert_cmd_zero "committed multi-repo work proves" \
  node .claude/harness/foundation.mjs prove cross-repository-profile
git -C api merge -q --ff-only "$api_commit"
git -C app merge -q --ff-only "$app_commit"
assert_cmd_fails_with "Land record stops for explicit user authority" \
  "requires --decision-ref" \
  node .claude/harness/foundation.mjs land-record cross-repository-profile \
  --repo api --commit "$api_commit" --ci pass
# Branch state is set explicitly so the default-branch warning is
# deterministic regardless of the machine's init.defaultBranch.
git -C api checkout -q -B main
api_record="$({ node .claude/harness/foundation.mjs land-record cross-repository-profile \
  --repo api --commit "$api_commit" --ci pass \
  --decision-ref fixture://user/land-api; } 2>&1)" \
  && pass "explicit API commit is bound to Land" \
  || fail "explicit API commit is bound to Land"
assert_contains "binding onto main warns without blocking" "$api_record" \
  "repository 'api' target is checked out on 'main'"
git -C app checkout -q -B feature-probe
app_record="$({ node .claude/harness/foundation.mjs land-record cross-repository-profile \
  --repo app --commit "$app_commit" --ci pass \
  --decision-ref fixture://user/land-app; } 2>&1)" \
  && pass "explicit app commit is bound to Land" \
  || fail "explicit app commit is bound to Land"
assert_not_contains "a feature branch stays silent at record" "$app_record" "WARNING"
resume_stage="$(node .claude/harness/foundation.mjs land-resume \
  cross-repository-profile)"
assert_contains "Land resume stages eligible root gitlinks transactionally" \
  "$resume_stage" "ROOT POINTERS STAGED"
if node .claude/harness/foundation.mjs land-check \
  cross-repository-profile >/dev/null 2>&1; then
  fail "root pointer staging invalidates composite proof"
else
  pass "root pointer staging invalidates composite proof"
fi
node .claude/harness/foundation.mjs proof-collect cross-repository-profile >/dev/null 2>&1 || true
node .claude/harness/foundation.mjs receipt cross-repository-profile \
  compatibility pass --observed "contract change is backward compatible" \
  --source harness-test --reference https://example.invalid/compat-review >/dev/null
node .claude/harness/foundation.mjs receipt cross-repository-profile \
review pass --observed "fixture review found no blockers" \
  --reviewer harness-test --subject-actor implementation-agent \
  --unresolved-blockers 0 \
  --reference "fixture://review" >/dev/null
assert_cmd_zero "pointer-aware composite proof refreshes" \
  node .claude/harness/foundation.mjs prove cross-repository-profile
resume_plan="$(node .claude/harness/foundation.mjs land-resume cross-repository-profile)"
assert_contains "Land resume observes landed children" \
  "$resume_plan" '"status": "child-landed"'
assert_contains "root target gitlink matches recorded commit" \
  "$resume_plan" '"readyToArchive": true'

# Per-repository setup: a topology row's `setupCommand` runs inside that
# repository's worktree, and `sandbox.setupCommand` still covers the root
# worktree. A separate superproject keeps the marker files out of the
# cross-repository-profile surface above.
mkdir -p "$TMP/setup-child"
cd "$TMP/setup-child"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
printf 'lib-before\n' > lib.txt
git add .
git commit -qm "lib fixture"
mkdir -p "$TMP/setup-multi/.claude/harness" "$TMP/setup-multi/openspec" \
  "$TMP/setup-multi/.foundation"
install_harness_fixture "$ROOT" "$TMP/setup-multi"
cp "$ROOT/.claude/harness/commands.json" "$TMP/setup-multi/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/setup-multi/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/setup-multi/openspec/"
cp "$ROOT/.foundation/.gitignore" "$TMP/setup-multi/.foundation/"
printf '%s\n' \
  '{"version":1,"repositories":[' \
  '  {"id":"lib","path":"lib","setupCommand":"printf repo-ready > setup-marker.txt"}' \
  ']}' > "$TMP/setup-multi/openspec/repositories.yaml"
printf '%s\n' \
  '{"version":1,"sandbox":{"setupCommand":"printf root-ready > setup-marker.txt"}}' \
  > "$TMP/setup-multi/foundation.json"
cd "$TMP/setup-multi"
git init -q
git config user.name "Foundation Test"
git config user.email "foundation@example.invalid"
git -c protocol.file.allow=always submodule add -q "$TMP/setup-child" lib
git add .
git commit -qm "setup fixture"
node .claude/harness/foundation.mjs new 'Setup fanout' >/dev/null
node .claude/harness/foundation.mjs resolve setup-fanout \
  --impact medium --coupling coupled --acceptance-not-required >/dev/null
printf '%s\n' \
  '{"version":1,"repositories":[' \
  '  {"id":"lib","mode":"write","dependsOn":[]}' \
  ']}' > openspec/changes/setup-fanout/repositories.yaml
printf '%s\n' \
  '# Tasks' \
  '' \
  '- [ ] **T001** Prepare lib [repo:lib] [kind:implementation] [paths:lib.txt]' \
  > openspec/changes/setup-fanout/tasks.md
assert_cmd_zero "setup fanout sandboxes create" \
  node .claude/harness/foundation.mjs sandbox create setup-fanout --all
assert_file_exists "root worktree setup command ran" \
  "$(jq -r '.workspace.path' .foundation/runtime/setup-fanout.json)/setup-marker.txt"
assert_eq "root worktree setup outcome recorded" "ok" \
  "$(jq -r '.workspace.setup.status' .foundation/runtime/setup-fanout.json)"
assert_file_exists "repository setup command ran in its worktree" \
  .foundation/repository-sandboxes/setup-fanout/lib/setup-marker.txt
assert_eq "repository setup outcome recorded" "ok" \
  "$(jq -r '.repositories.lib.setup.status' .foundation/runtime/setup-fanout.json)"
printf '%s\n' \
  '{"version":1,"repositories":[' \
  '  {"id":"lib","path":"lib","setupCommand":42}' \
  ']}' > openspec/repositories.yaml
assert_cmd_fails_with "invalid repository setupCommand is rejected" \
  "setupCommand must be a non-empty string" \
  node .claude/harness/foundation.mjs repos
cd "$TMP/multi-project"

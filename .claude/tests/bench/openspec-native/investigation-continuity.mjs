#!/usr/bin/env node
// Repository-only differential scenario: no model calls or product mutations.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clone = (v) => structuredClone(v);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const digest = (v) => createHash('sha256').update(v).digest('hex');

export async function runContinuityScenario(sourceRoot, sourceRef) {
  const runtimeModule = await import(pathToFileURL(join(sourceRoot,
    '.claude/harness/runtime/workflow/investigation-runtime.mjs')));
  const semantic = await import(pathToFileURL(join(sourceRoot,
    '.claude/harness/runtime/workflow/semantic-draft.mjs')));
  const lifecycle = await import(pathToFileURL(join(sourceRoot,
    '.claude/harness/runtime/workflow/change-lifecycle.mjs')));
  const root = mkdtempSync(join(tmpdir(), 'continuity-scenario-'));
  const checks = [];
  const observations = [];
  const check = (id, passed, observed) => checks.push({ id, passed: Boolean(passed), observed });
  try {
    mkdirSync(join(root, 'openspec/investigations'), { recursive: true });
    writeFileSync(join(root, 'evidence.md'), 'Payment retries share a revision guard; audit records use append-only storage.\n');
    const id = 'payment-retry-continuity';
    // Each arm uses its supported record envelope. Both receive identical rich
    // content; the legacy arm is not failed merely for rejecting version 2.
    const record = {
      ...runtimeModule.investigationRecordTemplate(), id, purpose: 'change',
      problem: 'Investigate payment retries without losing audit history', mode: 'analyze',
      sources: ['evidence.md'], facts: [{ key: 'guard', statement: 'Retries share a revision guard', sources: ['evidence.md'] }],
      hypotheses: [], decisions: [], conclusion: { summary: 'Use bounded retries and preserve audit storage' },
      changeIntent: 'Make payment retries safe',
      intent: { goal: 'Safe payment retries', outcome: 'No duplicate charges or lost history', actors: ['support'], scope: ['retry API'] },
      conversation: [{ key: 'request', speaker: 'user', statement: 'Retry failed payments, never delete history, keep existing storage', source: 'scenario:turn:1' }],
      requirements: [
        { key: 'retry', revision: 1, kind: 'behavior', statement: 'Retry failed payments', examples: ['Timeout then retry'], criteria: ['One charge'], origin: 'user', status: 'stated', material: true, conversationKeys: ['request'] },
        { key: 'history', revision: 1, kind: 'non-goal', statement: 'Never delete payment history', origin: 'user', status: 'stated', material: true, conversationKeys: ['request'] },
        { key: 'storage', revision: 1, kind: 'constraint', statement: 'Keep existing storage', origin: 'user', status: 'stated', material: true, conversationKeys: ['request'] }
      ], questions: [], work: [], experiments: [], historyGaps: ['Earlier chat is unavailable; do not invent its content']
    };
    const file = join(root, `openspec/investigations/${id}.json`);
    const inspect = (label) => {
      writeJson(file, record);
      // Recreate the runtime on every turn to exercise persisted resume state.
      const runtime = runtimeModule.createInvestigationRuntime({ root, readJson, writeJson,
        now: () => '2026-10-15T00:00:00Z', fail: (message) => { throw new Error(message); } });
      const log = console.log;
      console.log = () => {};
      let result;
      try { result = runtime.inspectInvestigation(`openspec/investigations/${id}.json`); }
      finally { console.log = log; }
      observations.push({ turn: label, action: result.action, boundary: result.boundary,
        handoff: Boolean(result.handoff), independentWork: result.independentWork,
        staleExperiments: result.staleExperiments, issues: result.investigation?.issues });
      return result;
    };
    const initial = inspect('explicit user request');
    check('clear-intent-no-blanket-confirmation', initial.action === 'DONE', initial.action);
    check('rich-handoff', initial.handoff?.intake?.requirements?.length === 3, initial.handoff?.version);

    record.questions.push({ key: 'eligibility', question: 'Retry only timeouts or all failures?', material: true, status: 'open' },
      { key: 'colour', question: 'Which debug colour?', material: false, status: 'open' });
    record.work = [{ key: 'audit-read', outcome: 'Inspect append-only history', questionKeys: [] },
      { key: 'retry-implementation', outcome: 'Implement selected eligibility', questionKeys: ['eligibility'] }];
    const waiting = inspect('material ambiguity plus independent work');
    check('material-question-blocks-handoff', waiting.action === 'ASK_USER' && !waiting.handoff, waiting.action);
    check('independent-work-continues', waiting.independentWork?.some((w) => w.key === 'audit-read') &&
      !waiting.independentWork.some((w) => w.key === 'retry-implementation'), waiting.independentWork);

    record.conversation.push({ key: 'answer', speaker: 'user', statement: 'Only timeouts may retry', source: 'scenario:turn:2' });
    Object.assign(record.questions[0], { status: 'answered', answer: 'Only timeouts may retry', conversationKeys: ['answer'] });
    const answered = inspect('answer reused; optional question stays open');
    check('optional-question-does-not-block', answered.action === 'DONE', answered.action);

    const experiment = (key, requirementKey) => ({ key, question: `Does ${requirementKey} work?`,
      material: true, status: 'complete', criteria: ['Local fixture passes'], findings: [`${key}: local pass`],
      limitations: ['Local fixture only; no production concurrency measurement'],
      requirementRefs: [{ key: requirementKey, revision: 1 }], prototypePaths: [`.foundation/prototypes/${id}/${key}.js`] });
    record.experiments.push(experiment('retry-poc', 'retry'), experiment('audit-poc', 'history'));
    inspect('two completed experiments');
    record.conversation.push({ key: 'correction', speaker: 'user', statement: 'Timeout retries must also reject stale revisions', source: 'scenario:turn:3' });
    Object.assign(record.requirements[0], { status: 'superseded', reason: 'User narrowed retry semantics', supersededBy: { key: 'retry', revision: 2 } });
    record.requirements.push({ ...clone(record.requirements[0]), revision: 2, status: 'stated',
      statement: 'Retry only timeouts at the latest revision', conversationKeys: ['correction'] });
    delete record.requirements[3].reason;
    delete record.requirements[3].supersededBy;
    const stale = inspect('partial correction invalidates only retry experiment');
    check('selective-poc-staleness', stale.boundary === 'experiment-review' &&
      JSON.stringify(stale.staleExperiments) === JSON.stringify(['retry-poc']), stale.staleExperiments);
    const state = readJson(join(root, stale.state.path));
    check('resume-retains-history', state.intake?.requirements?.length === 4 &&
      state.intake?.conversation?.length === 3 && state.intake?.historyGaps?.length === 1, state.intake?.requirements?.length);

    const old = clone(record.experiments[0]);
    record.experiments.push({ ...clone(old), key: 'retry-poc-v2', requirementRefs: [{ key: 'retry', revision: 2 }], findings: ['Stale timeout retry is rejected'] });
    Object.assign(record.experiments[0], { supersededBy: 'retry-poc-v2', reason: 'Rechecked only narrowed retry semantics' });
    const ready = inspect('reassessed experiment');
    check('reassessment-completes', ready.action === 'DONE', ready.action);
    check('old-results-retained', ready.handoff?.intake?.experiments?.[0]?.findings?.[0] === old.findings[0], ready.handoff?.intake?.experiments?.length);

    const valid = clone(record);
    record.requirements = record.requirements.filter((r) => r.key !== 'history');
    // Remove its experiment too: a dropped constraint must still be detected
    // without relying on a dangling experiment reference.
    record.experiments = record.experiments.filter((e) => e.key !== 'audit-poc');
    const dropped = inspect('accidental history constraint loss');
    check('missing-history-rejected', dropped.action === 'EDIT' && !dropped.handoff &&
      dropped.investigation?.issues?.some((s) => /retained requirement disappeared/.test(s)), dropped.action);
    Object.assign(record, clone(valid));
    inspect('restore retained history');

    record.conversation.shift();
    const lostConversation = inspect('original user request accidentally dropped');
    check('conversation-loss-rejected', lostConversation.action === 'EDIT' && !lostConversation.handoff &&
      lostConversation.investigation?.issues?.some((s) => /retained conversation event changed or disappeared/.test(s)), lostConversation.action);
    Object.assign(record, clone(valid));
    inspect('restore original request');
    record.requirements[3].statement = 'Retry every failure without a revision guard';
    const rewritten = inspect('latest revision overwritten in place');
    check('in-place-revision-rewrite-rejected', rewritten.action === 'EDIT' && !rewritten.handoff &&
      rewritten.investigation?.issues?.some((s) => /without a new revision/.test(s)), rewritten.action);
    Object.assign(record, clone(valid));
    inspect('restore correct revision');
    record.experiments[0].findings = ['Invented production concurrency pass'];
    const inventedResult = inspect('old PoC findings overwritten');
    check('completed-poc-rewrite-rejected', inventedResult.action === 'EDIT' && !inventedResult.handoff &&
      inventedResult.investigation?.issues?.some((s) => /completed result changed/.test(s)), inventedResult.action);
    Object.assign(record, clone(valid));
    inspect('restore original experiment findings');

    record.conversation.push({ key: 'suggestion', speaker: 'agent', statement: 'Delete failed-payment records automatically', source: 'scenario:agent:4' });
    record.requirements.push({ key: 'purge', revision: 1, kind: 'behavior', statement: 'Delete failed-payment records',
      origin: 'agent', status: 'confirmed', material: true, conversationKeys: ['suggestion'] });
    const silent = inspect('agent suggestion falsely labelled confirmed');
    check('silent-consent-rejected', silent.action === 'EDIT' && !silent.handoff &&
      silent.investigation?.issues?.some((s) => /silence is not confirmation/.test(s)), silent.action);
    Object.assign(record, clone(valid));
    const final = inspect('valid final handoff');
    check('recovery-does-not-need-user-reconfirmation', final.action === 'DONE', final.action);

    const draft = { version: 3, intent: record.changeIntent, impact: 'medium', coupling: 'coupled',
      requirements: [{ key: 'safe-retry', capability: 'payments', operation: 'added', outcome: 'One charge at latest revision',
        scenarios: [{ key: 'timeout', name: 'Stale timeout', kind: 'failure', when: 'A stale timeout is retried', then: 'Reject it' }] }],
      tasks: [{ key: 'implement', outcome: 'Implement safe retries', covers: ['safe-retry'], paths: ['src/**'], verify: 'node --test' }],
      evidence: { 'safe-retry': { capabilities: ['test'] } }, nonGoals: ['Never delete payment history'],
      decisions: [{ key: 'storage', choice: 'Keep existing storage', reason: 'No migration required' }],
      investigation: final.handoff,
      investigationCoverage: [
        { sourceKey: 'retry', sourceRevision: 2, targets: [{ kind: 'requirement', key: 'safe-retry' }, { kind: 'scenario', key: 'safe-retry', scenario: 'timeout' }] },
        { sourceKey: 'history', sourceRevision: 1, targets: [{ kind: 'non-goal', key: 'Never delete payment history' }] },
        { sourceKey: 'storage', sourceRevision: 1, targets: [{ kind: 'design', key: 'storage' }] }
      ] };
    const normalized = semantic.normalizeSemanticDraft(draft, slug);
    if (normalized.issues.length) throw new Error(`Valid scenario draft failed: ${normalized.issues.join('; ')}`);
    const proposal = lifecycle.renderDraftProposal(normalized.draft, { intent: draft.intent, schema: 'foundation-standard' });
    const details = ['Timeout then retry', 'One charge', 'scenario:turn:3', 'retry@1', 'retry@2', 'Local fixture only; no production concurrency measurement', 'Earlier chat is unavailable'];
    check('compiled-document-retains-details', details.every((s) => proposal.includes(s)), details.filter((s) => !proposal.includes(s)));
    draft.investigationCoverage.pop();
    const missing = semantic.normalizeSemanticDraft(draft, slug).issues;
    check('change-refuses-uncovered-constraint', missing.some((s) => /storage@1.*uncovered/.test(s)), missing);
    const broken = clone(draft);
    broken.investigationCoverage[0].targets[1].scenario = 'invented';
    check('change-refuses-invented-target', semantic.normalizeSemanticDraft(broken, slug).issues.some((s) => /invalid scenario target/.test(s)), null);
    record.conversation.push({ key: 'later', speaker: 'user', statement: 'New requirement arrived after handoff', source: 'scenario:turn:5' });
    writeJson(file, record);
    check('old-handoff-rejected-after-new-turn', runtimeModule.validateInvestigationBinding({ projectRoot: root,
      binding: final.handoff }).some((s) => /request changed/.test(s)), null);
    return { sourceRef, recordVersion: record.version, passed: checks.filter((c) => c.passed).length,
      total: checks.length, checks, observations, proposal };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const before = args[0] || 'd157286b9b32c4374fcb94accf7c1a430c04228d';
  const temporary = mkdtempSync(join(tmpdir(), 'continuity-before-'));
  try {
    const beforeRef = execFileSync('git', ['rev-parse', '--verify', `${before}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['archive', beforeRef, '.claude/harness'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', temporary], { input: archive });
    const prior = await runContinuityScenario(temporary, beforeRef);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const current = await runContinuityScenario(ROOT, head);
    const output = resolve(ROOT, '.foundation/test-results/investigation-continuity-comparison');
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'before-proposal.md'), prior.proposal);
    writeFileSync(join(output, 'after-proposal.md'), current.proposal);
    delete prior.proposal; delete current.proposal;
    const report = { protocol: 'investigation-continuity-differential-v1', execution: 'deterministic-runtime-and-compiler-seam',
      zeroModelSpend: true, scenarioDigest: digest(readFileSync(fileURLToPath(import.meta.url))), before: prior, after: current };
    writeJson(join(output, 'comparison.json'), report);
    console.log(JSON.stringify({ protocol: report.protocol, execution: report.execution,
      zeroModelSpend: true, scenarioDigest: report.scenarioDigest, output,
      before: { sourceRef: prior.sourceRef, recordVersion: prior.recordVersion, passed: prior.passed, total: prior.total },
      after: { sourceRef: current.sourceRef, recordVersion: current.recordVersion, passed: current.passed, total: current.total },
      checks: current.checks.map((check, i) => ({ id: check.id, before: prior.checks[i].passed, after: check.passed }))
    }, null, 2));
    if (current.passed !== current.total) process.exitCode = 1;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

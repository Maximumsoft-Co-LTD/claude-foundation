import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createApplyRecovery({
  transactions, transactionJournalPath, readJson, verifyAppliedProjection,
  saveApplyJournal, rollbackApplyTransaction, now, blockWithDecision, fail
}) {
  function recoverPendingApply(id, state) {
    const transactionRoot = join(transactions, id);
    if (!existsSync(transactionRoot)) return;
    for (const entry of readdirSync(transactionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = transactionJournalPath(id, entry.name);
      if (!existsSync(path)) continue;
      const journal = readJson(path);
      if (["rolling-back", "manual-recovery"].includes(journal.status))
        blockWithDecision(id, "apply-manual-recovery", journal.decision || {
          kind: "manual-recovery",
          summary: "An earlier apply stopped partway through rolling back and left the working tree in a state Foundation did not finish resolving.",
          options: [
            {
              id: "inspect",
              outcome: "Inspect the working tree against the recorded transaction backup before choosing a recovery."
            },
            {
              id: "keep-current",
              outcome: "Preserve the current files and abandon automatic rollback."
            },
            {
              id: "restore-backup",
              outcome: "Restore the recorded backup after explicitly resolving the divergence."
            },
            { id: "pause", outcome: "Leave the journal pending and make no further changes." }
          ],
          recommended: "inspect",
          transactionRoot: join(transactionRoot, entry.name)
        });
      if (!["prepared", "applying"].includes(journal.status)) continue;
      if (state.workspace?.applied &&
          state.workspace.apply?.transactionId === journal.transactionId) {
        const verification = verifyAppliedProjection(state);
        if (!verification.valid)
          fail(`interrupted apply cannot resume: ${verification.reason}`);
        journal.status = "verified";
        journal.verifiedAt = now();
        saveApplyJournal(journal);
      } else {
        try {
          rollbackApplyTransaction(journal, "interrupted apply recovered before retry");
        } catch (error) {
          fail(error.message);
        }
      }
    }
  }

  return { recoverPendingApply };
}

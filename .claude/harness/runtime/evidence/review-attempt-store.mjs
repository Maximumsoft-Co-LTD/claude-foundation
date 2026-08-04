import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createReviewAttemptStore({
  receiptsRoot,
  evidenceVault,
  readJson,
  writeJson,
  loadRuntime,
  saveRuntime,
  stableHash,
  reviewReceiptBinding,
  now,
  fail
}) {
  function reviewHistoryState(id, state = loadRuntime(id)) {
    const receiptDir = join(receiptsRoot, id);
    const candidates = existsSync(receiptDir)
      ? readdirSync(receiptDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "proof.json")
        .map((entry) => readJson(join(receiptDir, entry.name), {}))
        .filter((receipt) => receipt.review)
      : [];
    if (state.reviewHistory?.version === 1 &&
        (Number(state.reviewHistory.totalAttempts || 0) > 0 || candidates.length === 0))
      return state.reviewHistory;
    const latest = candidates.sort((a, b) => Number(b.review?.round || 0) - Number(a.review?.round || 0))[0];
    const round = Number(latest?.review?.round || 0);
    const aiAttempts = latest?.review?.reviewer?.type === "ai" ? Math.min(round, 2) : round >= 3 ? 2 : 0;
    let migratedAttempt = null;
    if (latest) {
      migratedAttempt = {
        version: 1, changeId: id, attempt: round || 1,
        reviewerType: latest.review?.reviewer?.type || "unknown",
        workspaceHash: latest.workspaceHash || null, status: latest.status || null,
        reviewBinding: reviewReceiptBinding(latest),
        priorChainHead: null, migrated: true,
        migratedFromReceiptDigest: stableHash(latest), timestamp: now()
      };
      migratedAttempt.digest = stableHash(migratedAttempt);
      writeJson(join(evidenceVault, id, "review-attempts",
        `${String(round || 1).padStart(4, "0")}-${migratedAttempt.digest.slice(0, 12)}.json`), migratedAttempt);
    }
    state.reviewHistory = {
      version: 1, aiAttempts, totalAttempts: round,
      chainHead: migratedAttempt?.digest || null,
      migratedFromReceiptDigest: latest ? stableHash(latest) : null
    };
    saveRuntime(state);
    return state.reviewHistory;
  }

  function reviewAttemptByDigest(id, digest) {
    const dir = join(evidenceVault, id, "review-attempts");
    if (!digest || !existsSync(dir)) return null;
    const name = readdirSync(dir).find((entry) => entry.includes(String(digest).slice(0, 12)));
    if (!name) return null;
    const attempt = readJson(join(dir, name), {});
    const claimed = attempt.digest;
    const canonical = { ...attempt };
    delete canonical.digest;
    return claimed === digest && stableHash(canonical) === claimed ? attempt : null;
  }

  function reviewHistoryChainValid(id, history) {
    let digest = history.chainHead || null;
    let expectedAttempt = Number(history.totalAttempts || 0);
    const seen = new Set();
    while (digest) {
      if (seen.has(digest) || seen.size > 1000) return false;
      seen.add(digest);
      const attempt = reviewAttemptByDigest(id, digest);
      if (!attempt || Number(attempt.attempt) !== expectedAttempt || attempt.changeId !== id)
        return false;
      digest = attempt.priorChainHead || null;
      expectedAttempt -= 1;
    }
    return expectedAttempt === 0 || Boolean(reviewAttemptByDigest(id, history.chainHead)?.migrated);
  }

  function reserveReviewAttempt(id, reviewerType, receiptSeed) {
    const state = loadRuntime(id);
    const history = reviewHistoryState(id, state);
    if (history.chainHead && !reviewHistoryChainValid(id, history))
      fail("review attempt history is missing or corrupt; restore the evidence chain before recording another review");
    if (reviewerType === "ai" && Number(history.aiAttempts || 0) >= 2)
      fail("AI review is limited to two rounds (attempts); further review requires a human");
    const attempt = {
      version: 1, changeId: id,
      attempt: Number(history.totalAttempts || 0) + 1,
      reviewerType, priorChainHead: history.chainHead || null,
      workspaceHash: receiptSeed.workspaceHash, status: receiptSeed.status,
      reviewBinding: receiptSeed.reviewBinding,
      timestamp: now()
    };
    attempt.digest = stableHash(attempt);
    state.reviewHistory = {
      version: 1,
      aiAttempts: Number(history.aiAttempts || 0) + (reviewerType === "ai" ? 1 : 0),
      totalAttempts: attempt.attempt,
      chainHead: attempt.digest
    };
    const path = join(evidenceVault, id, "review-attempts", `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`);
    writeJson(path, attempt);
    saveRuntime(state);
    return attempt;
  }

  return {
    reviewHistoryState,
    reviewAttemptByDigest,
    reviewHistoryChainValid,
    reserveReviewAttempt
  };
}

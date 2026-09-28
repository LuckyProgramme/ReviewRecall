const getAdminSupabase = require("../adminSupabase");
const reviewerService = require("./reviewerService");
const attemptService = require("./attemptService");
const { cleanupExpiredSession } = require("./expiredSessionCleanup");

const BATCH = 10;
const MAX_JOBS = 2;
const UPLOAD_INTENT_TTL_MS = 5 * 60000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
let jobsRunning = false;
let cleanupRunning = false;

function safeIntentPath(path, guestId, kind) {
  if (typeof path !== "string" || typeof guestId !== "string") return false;
  const extension = kind === "pdf" ? "pdf" : "(?:webm|ogg|wav|mp3|m4a)";
  return new RegExp(`^${guestId.toLowerCase()}/${UUID}\\.${extension}$`, "i").test(path);
}

async function removeIntentObject(admin, bucketName, path) {
  const removed = await admin.storage.from(bucketName).remove([path]);
  if (removed.error) throw removed.error;
}

async function expireAbandonedUploads(admin, now = Date.now()) {
  const cutoff = new Date(now - UPLOAD_INTENT_TTL_MS).toISOString();
  const reviewerCandidates = await admin.from("reviewer")
    .select("reviewer_id,guest_id,file_path,status").eq("status", "awaiting_upload")
    .lt("created_at", cutoff).limit(BATCH);
  if (reviewerCandidates.error) throw reviewerCandidates.error;
  const pendingReviewers = await admin.from("reviewer")
    .select("reviewer_id,guest_id,file_path,status").eq("status", "failed")
    .eq("error_code", "UPLOAD_CLEANUP_PENDING").limit(BATCH);
  if (pendingReviewers.error) throw pendingReviewers.error;
  const claimedReviewers = [...(pendingReviewers.data || [])];
  for (const row of reviewerCandidates.data || []) {
    const claim = await admin.from("reviewer").update({ status: "failed",
      error_code: "UPLOAD_CLEANUP_PENDING", updated_at: new Date(now).toISOString() })
      .eq("reviewer_id", row.reviewer_id).eq("status", "awaiting_upload")
      .lt("created_at", cutoff).select("reviewer_id,guest_id,file_path,status").maybeSingle();
    if (claim.error) throw claim.error;
    if (claim.data) claimedReviewers.push(claim.data);
  }
  for (const row of claimedReviewers.slice(0, BATCH)) {
    if (!safeIntentPath(row.file_path, row.guest_id, "pdf")) throw new Error("Unsafe reviewer upload path");
    await removeIntentObject(admin, "reviewer_upload", row.file_path);
    const expired = await admin.from("reviewer").update({ error_code: "UPLOAD_EXPIRED",
      updated_at: new Date(now).toISOString() }).eq("reviewer_id", row.reviewer_id)
      .eq("status", "failed").eq("error_code", "UPLOAD_CLEANUP_PENDING");
    if (expired.error) throw expired.error;
  }

  const attemptCandidates = await admin.from("audio_attempt")
    .select("attempt_id,file_path,status,study_run_item(study_run(guest_id))")
    .eq("status", "awaiting_upload").lt("created_at", cutoff).limit(BATCH);
  if (attemptCandidates.error) throw attemptCandidates.error;
  const pendingAttempts = await admin.from("audio_attempt")
    .select("attempt_id,file_path,status,study_run_item(study_run(guest_id))")
    .eq("status", "failed").eq("error_code", "UPLOAD_CLEANUP_PENDING").limit(BATCH);
  if (pendingAttempts.error) throw pendingAttempts.error;
  const claimedAttempts = [...(pendingAttempts.data || [])];
  for (const row of attemptCandidates.data || []) {
    const claim = await admin.from("audio_attempt").update({ status: "failed",
      error_code: "UPLOAD_CLEANUP_PENDING" }).eq("attempt_id", row.attempt_id)
      .eq("status", "awaiting_upload").lt("created_at", cutoff)
      .select("attempt_id,file_path,status,study_run_item(study_run(guest_id))").maybeSingle();
    if (claim.error) throw claim.error;
    if (claim.data) claimedAttempts.push(claim.data);
  }
  for (const row of claimedAttempts.slice(0, BATCH)) {
    const guestId = row.study_run_item?.study_run?.guest_id;
    if (!safeIntentPath(row.file_path, guestId, "audio")) throw new Error("Unsafe audio upload path");
    await removeIntentObject(admin, "reviewer_audio", row.file_path);
    const expired = await admin.from("audio_attempt").update({ error_code: "UPLOAD_EXPIRED" })
      .eq("attempt_id", row.attempt_id).eq("status", "failed")
      .eq("error_code", "UPLOAD_CLEANUP_PENDING");
    if (expired.error) throw expired.error;
  }
  return { reviewers: claimedReviewers.length, attempts: claimedAttempts.length };
}

async function reclaim(table, phases, admin) {
  const now = new Date().toISOString();
  for (const phase of phases) {
    const stale = await admin.from(table).select(table === "reviewer" ? "reviewer_id,attempts" : "attempt_id,attempts")
      .eq("status", phase).lt("lease_until", now).limit(BATCH);
    if (stale.error) throw stale.error;
    for (const row of stale.data) {
      const id = row.reviewer_id || row.attempt_id;
      const key = table === "reviewer" ? "reviewer_id" : "attempt_id";
      const exhausted = row.attempts >= 3;
      const result = await admin.from(table).update({ status: exhausted ? "failed" : "queued",
        error_code: exhausted ? "PROCESSING_FAILED" : null, lease_until: null })
        .eq(key, id).eq("status", phase).lt("lease_until", now);
      if (result.error) throw result.error;
    }
  }
}

async function sweepJobs(admin = getAdminSupabase()) {
  if (jobsRunning) return;
  jobsRunning = true;
  try {
    await expireAbandonedUploads(admin);
    await reclaim("reviewer", ["extracting", "generating"], admin);
    await reclaim("audio_attempt", ["transcribing", "evaluating"], admin);
    const reviewers = await admin.from("reviewer").select("reviewer_id").eq("status", "queued").limit(MAX_JOBS);
    if (reviewers.error) throw reviewers.error;
    await Promise.all(reviewers.data.map(row => reviewerService.processReviewer(row.reviewer_id, { admin })));
    const attempts = await admin.from("audio_attempt").select("attempt_id").eq("status", "queued").limit(MAX_JOBS);
    if (attempts.error) throw attempts.error;
    await Promise.all(attempts.data.map(row => attemptService.processAttempt(row.attempt_id, { admin })));
  } finally { jobsRunning = false; }
}

async function sweepCleanup(admin = getAdminSupabase()) {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const expired = await admin.from("guest_session").select("guest_id")
      .lte("expired_at", new Date().toISOString()).limit(BATCH);
    if (expired.error) throw expired.error;
    for (const row of expired.data) await cleanupExpiredSession(row.guest_id, admin);
  } finally { cleanupRunning = false; }
}

async function sweep(admin = getAdminSupabase()) {
  await Promise.all([sweepJobs(admin), sweepCleanup(admin)]);
}

function startWorker() {
  const tickJobs = () => sweepJobs().catch(() => {
    // No source text, audio, model output, or credentials in operational logs.
    console.error("Background job sweep failed");
  });
  const tickCleanup = () => sweepCleanup().catch(() => console.error("Session cleanup sweep failed"));
  tickJobs();
  tickCleanup();
  const jobTimer = setInterval(tickJobs, 15000);
  const cleanupTimer = setInterval(tickCleanup, 60000);
  jobTimer.unref?.();
  cleanupTimer.unref?.();
  return { jobTimer, cleanupTimer };
}

module.exports = { safeIntentPath, expireAbandonedUploads, reclaim, sweep, sweepJobs, sweepCleanup, startWorker };

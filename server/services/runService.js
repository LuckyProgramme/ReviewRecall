const crypto = require("crypto");
const getAdminSupabase = require("../adminSupabase");
const { ApiError, requireUuid } = require("./apiError");
const { liveGuest } = require("./guestAccess");
const reviewerService = require("./reviewerService");

function shuffle(concepts, seed) {
  return [...concepts].sort((a, b) => {
    const ah = crypto.createHash("sha256").update(`${seed}:${a.concept_id}`).digest("hex");
    const bh = crypto.createHash("sha256").update(`${seed}:${b.concept_id}`).digest("hex");
    return ah.localeCompare(bh) || a.concept_id.localeCompare(b.concept_id);
  });
}

async function ownedRun(guestId, runId, admin = getAdminSupabase()) {
  requireUuid(runId, "run ID");
  await liveGuest(guestId, { admin });
  const result = await admin.from("study_run").select("*")
    .eq("run_id", runId).eq("guest_id", guestId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "RUN_NOT_FOUND", "Run not found");
  return result.data;
}

async function runView(guestId, runId, admin = getAdminSupabase()) {
  const run = await ownedRun(guestId, runId, admin);
  const result = await admin.from("study_run_item").select("item_id,concept_id,position,verdict,reason,feedback,completed_at,result_attempt_number")
    .eq("run_id", runId).order("position");
  if (result.error) throw result.error;
  const itemIds = result.data.map(item => item.item_id);
  const attemptResult = itemIds.length ? await admin.from("audio_attempt")
    .select("attempt_id,item_id,attempt_number,transcript,status,details").in("item_id", itemIds)
    .eq("status", "completed") : { data: [] };
  if (attemptResult.error) throw attemptResult.error;
  const completedAttempts = new Map(attemptResult.data.map(row => [`${row.item_id}:${row.attempt_number}`, row]));
  const pendingResult = itemIds.length ? await admin.from("audio_attempt")
    .select("attempt_id,item_id,attempt_number,status").in("item_id", itemIds)
    .in("status", ["awaiting_upload", "queued", "transcribing", "evaluating"])
    .order("attempt_number", { ascending: false }) : { data: [] };
  if (pendingResult.error) throw pendingResult.error;
  const pendingByItem = new Map();
  for (const row of pendingResult.data) if (!pendingByItem.has(row.item_id)) pendingByItem.set(row.item_id, row);
  const concepts = await reviewerService.getConcepts(guestId, run.topic_id, admin);
  const byId = new Map(concepts.map(concept => [concept.concept_id, concept]));
  const items = result.data.map(item => {
    const concept = byId.get(item.concept_id);
    if (!concept) throw new Error("Run concept missing");
    const attempt = item.reason === "skipped" ? null
      : completedAttempts.get(`${item.item_id}:${item.result_attempt_number}`);
    const pending = pendingByItem.get(item.item_id);
    return { item_id: item.item_id, concept_id: item.concept_id, concept_name: concept.name,
      position: item.position, reference: concept.reference,
      ...(pending ? { pending_attempt_id: pending.attempt_id, pending_attempt_status: pending.status } : {}),
      latest_result: item.verdict ? { verdict: item.verdict, reason: item.reason,
        feedback: item.feedback || "", completed_at: item.completed_at,
        ...(attempt ? { attempt_id: attempt.attempt_id, transcript: attempt.transcript || "",
          details: attempt.details || undefined } : {}) } : null };
  });
  return { run_id: run.run_id, topic_id: run.topic_id, current_index: run.current_index,
    current_item_id: items[run.current_index]?.item_id || null,
    status: run.current_index >= items.length ? "completed" : "active", items };
}

async function startRun(guestId, topicId, admin = getAdminSupabase()) {
  await reviewerService.ownedTopic(guestId, topicId, admin);
  await liveGuest(guestId, { admin, touch: true });
  const concepts = await reviewerService.getConcepts(guestId, topicId, admin);
  if (!concepts.length) throw new ApiError(409, "NO_CONCEPTS", "Topic has no concepts");
  const seed = crypto.randomUUID();
  const orderedIds = shuffle(concepts, seed).map(item => item.concept_id);
  const result = await admin.rpc("start_study_run", { p_guest_id: guestId, p_topic_id: topicId,
    p_seed: seed, p_concept_ids: orderedIds });
  if (result.error) throw result.error;
  return runView(guestId, result.data, admin);
}

async function currentItem(guestId, runId, itemId, admin = getAdminSupabase()) {
  requireUuid(itemId, "item ID");
  const run = await runView(guestId, runId, admin);
  if (run.current_item_id !== itemId) throw new ApiError(409, "ITEM_NOT_CURRENT", "Concept is not current");
  return run;
}

async function advance(guestId, runId, itemId, admin = getAdminSupabase()) {
  requireUuid(itemId, "item ID");
  const run = await runView(guestId, runId, admin);
  if (run.current_item_id !== itemId) {
    if (run.items.some(item => item.item_id === itemId && item.position < run.current_index)) return run;
    throw new ApiError(409, "ITEM_NOT_CURRENT", "Concept is not current");
  }
  if (!run.items[run.current_index]?.latest_result)
    throw new ApiError(409, "ITEM_UNANSWERED", "Explain or skip this concept first");
  const pending = await admin.from("audio_attempt").select("attempt_id").eq("item_id", itemId)
    .in("status", ["awaiting_upload", "queued", "transcribing", "evaluating"]).limit(1);
  if (pending.error) throw pending.error;
  if (pending.data?.length)
    throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Finish or cancel this recording first");
  await liveGuest(guestId, { admin, touch: true });
  const result = await admin.rpc("advance_study_run", { p_run_id: runId, p_guest_id: guestId, p_item_id: itemId });
  if (result.error) throw result.error;
  if (result.data === "unanswered") throw new ApiError(409, "ITEM_UNANSWERED", "Explain or skip this concept first");
  if (result.data === "attempt_in_progress")
    throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Finish this recording first");
  return runView(guestId, runId, admin);
}

async function skip(guestId, runId, itemId, admin = getAdminSupabase()) {
  const run = await currentItem(guestId, runId, itemId, admin);
  const item = run.items[run.current_index];
  if (item.latest_result) {
    if (item.latest_result.reason === "skipped") return run;
  }
  const pending = await admin.from("audio_attempt").select("attempt_id").eq("item_id", itemId)
    .in("status", ["awaiting_upload", "queued", "transcribing", "evaluating"]).limit(1);
  if (pending.error) throw pending.error;
  if (pending.data?.length)
    throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Wait for this recording before skipping");
  await liveGuest(guestId, { admin, touch: true });
  const result = await admin.rpc("skip_study_item", { p_run_id: runId,
    p_guest_id: guestId, p_item_id: itemId });
  if (result.error) throw result.error;
  if (result.data === "attempt_in_progress")
    throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Wait for this recording before skipping");
  if (result.data === "item_not_current")
    throw new ApiError(409, "ITEM_NOT_CURRENT", "Concept is not current");
  return runView(guestId, runId, admin);
}

async function summary(guestId, runId, admin = getAdminSupabase()) {
  const run = await runView(guestId, runId, admin);
  if (run.status !== "completed") throw new ApiError(409, "RUN_NOT_COMPLETE", "Run is not complete");
  const counts = { Pass: 0, Partial: 0, Fail: 0 };
  const concepts = run.items.map(item => {
    const verdict = item.latest_result?.verdict || "Fail";
    counts[verdict]++;
    return { item_id: item.item_id, concept_id: item.concept_id, concept_name: item.concept_name,
      verdict, reason: item.latest_result?.reason || "skipped", feedback: item.latest_result?.feedback || "" };
  });
  return { run_id: runId, counts, concepts };
}

module.exports = { shuffle, ownedRun, runView, startRun, currentItem, advance, skip, summary };

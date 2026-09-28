const crypto = require("crypto");
const getAdminSupabase = require("../adminSupabase");
const { ApiError, requireUuid } = require("./apiError");
const { liveGuest } = require("./guestAccess");
const runService = require("./runService");
const gemini = require("./gemini");
const { generateValidated } = require("./modelOutput");

const BUCKET = "reviewer_audio";
const MAX_SIZE = 12 * 1024 * 1024;
const MIMES = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/m4a"]);

function validateAudio(input) {
  const mime = typeof input?.file_type === "string" ? input.file_type.split(";")[0].trim().toLowerCase() : "";
  if (!MIMES.has(mime)) throw new ApiError(400, "INVALID_AUDIO_TYPE", "Audio format is unsupported");
  if (!Number.isSafeInteger(input?.file_size) || input.file_size < 1 || input.file_size > MAX_SIZE)
    throw new ApiError(400, "INVALID_AUDIO_SIZE", "Audio must be at most 12 MiB");
  if (typeof input?.duration_seconds !== "number" || !Number.isFinite(input.duration_seconds) ||
      input.duration_seconds <= 0 || input.duration_seconds > 61)
    throw new ApiError(400, "INVALID_AUDIO_DURATION", "Recording must be at most one minute");
  return mime;
}

async function signAttempt(guestId, runId, itemId, input, admin = getAdminSupabase()) {
  const mime = validateAudio(input);
  await runService.currentItem(guestId, runId, itemId, admin);
  await liveGuest(guestId, { admin, touch: true });
  if (input?.attempt_id) {
    const existing = await ownedAttempt(guestId, input.attempt_id, admin);
    if (existing.item_id !== itemId || existing.status !== "awaiting_upload" ||
        existing.file_type !== mime || existing.file_size !== input.file_size ||
        Math.abs(Number(existing.duration_seconds) - input.duration_seconds) > 0.1)
      throw new ApiError(409, "ATTEMPT_CONFLICT", "Attempt cannot be re-signed");
    const refreshed = await admin.storage.from(BUCKET).createSignedUploadUrl(existing.file_path);
    if (refreshed.error) throw refreshed.error;
    return { attempt_id: existing.attempt_id, path: existing.file_path,
      token: refreshed.data.token, status: "awaiting_upload" };
  }
  const ext = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav",
    "audio/mpeg": "mp3", "audio/m4a": "m4a" }[mime];
  const path = `${guestId}/${crypto.randomUUID()}.${ext}`;
  const inserted = await admin.rpc("create_audio_attempt", { p_guest_id: guestId,
    p_run_id: runId, p_item_id: itemId, p_file_path: path, p_file_type: mime,
    p_file_size: input.file_size, p_duration_seconds: input.duration_seconds });
  if (inserted.error) {
    if (inserted.error.code === "23505") throw new ApiError(409, "ATTEMPT_CONFLICT", "Retry recording");
    if (inserted.error.message === "Item not current")
      throw new ApiError(409, "ITEM_NOT_CURRENT", "Concept is not current");
    if (inserted.error.message === "Attempt in progress")
      throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Wait for the current recording");
    if (inserted.error.message === "Session expired")
      throw new ApiError(410, "SESSION_EXPIRED", "Session expired");
    throw inserted.error;
  }
  const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) {
    await admin.from("audio_attempt").delete().eq("attempt_id", inserted.data);
    throw signed.error;
  }
  return { attempt_id: inserted.data, path, token: signed.data.token, status: "awaiting_upload" };
}

async function ownedAttempt(guestId, attemptId, admin = getAdminSupabase()) {
  requireUuid(attemptId, "attempt ID");
  await liveGuest(guestId, { admin });
  const result = await admin.from("audio_attempt").select("*").eq("attempt_id", attemptId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  const item = await admin.from("study_run_item").select("item_id,run_id")
    .eq("item_id", result.data.item_id).maybeSingle();
  if (item.error) throw item.error;
  if (!item.data) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  const run = await admin.from("study_run").select("guest_id").eq("run_id", item.data.run_id)
    .eq("guest_id", guestId).maybeSingle();
  if (run.error) throw run.error;
  if (!run.data) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  return { ...result.data, study_run_item: { ...item.data, study_run: run.data } };
}

function attemptView(row) {
  const result = { attempt_id: row.attempt_id, status: row.status, error_code: row.error_code || undefined };
  if (row.status === "failed") result.retryable = row.attempts < 3 &&
    ["MODEL_UNAVAILABLE", "MODEL_RATE_LIMITED", "MODEL_QUOTA_EXCEEDED", "MODEL_TIMEOUT",
      "MODEL_NOT_CONFIGURED", "MODEL_OUTPUT_INVALID", "PROCESSING_FAILED",
      "AUDIO_DOWNLOAD_FAILED"].includes(row.error_code);
  if (row.status === "completed") {
    result.transcript = row.transcript || "";
    result.verdict = row.verdict;
    result.feedback = row.feedback || "";
    result.details = row.details || undefined;
  }
  return result;
}

async function verifyAudioObject(row, admin) {
  const [folder, name] = row.file_path.split("/");
  if (folder !== row.study_run_item.study_run.guest_id || !/^[0-9a-f-]+\.[a-z0-9]+$/i.test(name))
    throw new ApiError(400, "INVALID_AUDIO", "Audio path is invalid");
  const result = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 100 });
  if (result.error) throw result.error;
  const object = result.data?.find(item => item.name === name && item.id);
  if (!object) throw new ApiError(409, "UPLOAD_MISSING", "Uploaded audio was not found");
  const size = Number(object.metadata?.size);
  const mime = object.metadata?.mimetype || object.metadata?.contentType;
  if (size !== row.file_size || size > MAX_SIZE || (mime && mime.split(";")[0] !== row.file_type))
    throw new ApiError(400, "INVALID_AUDIO", "Uploaded audio does not match the signed file");
  return object;
}

async function completeAttempt(guestId, attemptId, admin = getAdminSupabase()) {
  const row = await ownedAttempt(guestId, attemptId, admin);
  if (row.status === "failed" && row.attempts < 3 &&
      ["MODEL_UNAVAILABLE", "MODEL_RATE_LIMITED", "MODEL_QUOTA_EXCEEDED", "MODEL_TIMEOUT",
        "MODEL_NOT_CONFIGURED", "MODEL_OUTPUT_INVALID",
        "PROCESSING_FAILED", "AUDIO_DOWNLOAD_FAILED"].includes(row.error_code)) {
    await runService.currentItem(guestId, row.study_run_item.run_id, row.item_id, admin);
    await liveGuest(guestId, { admin, touch: true });
    const retry = await admin.from("audio_attempt").update({ status: "queued", error_code: null })
      .eq("attempt_id", attemptId).eq("status", "failed").select("*").maybeSingle();
    if (retry.error) throw retry.error;
    return attemptView(retry.data || await ownedAttempt(guestId, attemptId, admin));
  }
  if (row.status !== "awaiting_upload") return attemptView(row);
  await runService.currentItem(guestId, row.study_run_item.run_id, row.item_id, admin);
  await verifyAudioObject(row, admin);
  await liveGuest(guestId, { admin, touch: true });
  const updated = await admin.from("audio_attempt").update({ status: "queued" })
    .eq("attempt_id", attemptId).eq("status", "awaiting_upload").select("*").maybeSingle();
  if (updated.error) throw updated.error;
  return attemptView(updated.data || await ownedAttempt(guestId, attemptId, admin));
}

async function cancelAttempt(guestId, attemptId, admin = getAdminSupabase()) {
  const row = await ownedAttempt(guestId, attemptId, admin);
  if (row.status === "cancelled") return attemptView(row);
  if (row.status !== "awaiting_upload")
    throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Attempt can no longer be canceled");
  const result = await admin.from("audio_attempt").update({ status: "cancelled", error_code: "UPLOAD_CANCELLED" })
    .eq("attempt_id", attemptId).eq("status", "awaiting_upload").select("*").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(409, "ATTEMPT_IN_PROGRESS", "Attempt can no longer be canceled");
  return attemptView(result.data);
}

async function readAudio(row, admin) {
  const download = await admin.storage.from(BUCKET).download(row.file_path);
  if (download.error || !download.data)
    throw Object.assign(new Error("Audio download failed"), { code: "AUDIO_DOWNLOAD_FAILED" });
  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (bytes.length !== row.file_size || bytes.length > MAX_SIZE)
    throw Object.assign(new Error("Audio size mismatch"), { code: "INVALID_AUDIO" });
  await validateDecodedAudio(bytes, row.file_type, Number(row.duration_seconds));
  return bytes;
}

async function validateDecodedAudio(bytes, fileType, declaredDuration) {
  const { parseBuffer } = await import("music-metadata");
  let metadata;
  try { metadata = await parseBuffer(bytes, fileType, { duration: true }); }
  catch { throw Object.assign(new Error("Audio cannot be decoded"), { code: "INVALID_AUDIO" }); }
  const container = String(metadata.format.container || "").toLowerCase();
  const expected = {
    "audio/webm": /webm|matroska/,
    "audio/ogg": /ogg/,
    "audio/wav": /wave|wav/,
    "audio/mpeg": /mpeg|mp3/,
    "audio/m4a": /mp4|mpeg-4|m4a/,
  }[fileType];
  if (!expected?.test(container))
    throw Object.assign(new Error("Audio format mismatch"), { code: "INVALID_AUDIO" });
  let duration = metadata.format.duration;
  if (!Number.isFinite(duration) && fileType === "audio/webm") {
    try {
      const { Decoder, Reader } = require("ts-ebml");
      const decoder = new Decoder();
      const reader = new Reader();
      for (const element of decoder.decode(bytes)) reader.read(element);
      reader.stop();
      if (reader.trackInfo?.type !== "audio" && reader.trackInfo?.type !== "both")
        throw new Error("WebM has no audio track");
      duration = reader.duration * reader.timestampScale / 1000000000;
    } catch {
      throw Object.assign(new Error("WebM duration cannot be decoded"), { code: "INVALID_AUDIO" });
    }
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 61.5)
    throw Object.assign(new Error("Audio duration invalid"), { code: "INVALID_AUDIO_DURATION" });
  if (Math.abs(duration - declaredDuration) > 3)
    throw Object.assign(new Error("Audio duration mismatch"), { code: "INVALID_AUDIO_DURATION" });
  return duration;
}

function validateTranscript(raw) {
  if (!["clear", "unclear", "silent"].includes(raw?.speech_state) ||
      typeof raw.transcript !== "string" || raw.transcript.length > 10000 ||
      !Array.isArray(raw.unclear_spans)) throw new Error("Invalid transcript output");
  if (raw.speech_state === "clear" && !raw.transcript.trim()) throw new Error("Empty clear transcript");
  return raw;
}

function validateEvaluation(raw, ideas) {
  const ideaIds = new Set(ideas.map(idea => idea.idea_id));
  if (!["Pass", "Partial", "Fail"].includes(raw?.verdict) ||
      !Array.isArray(raw.matched_idea_ids) || !Array.isArray(raw.missing_idea_ids) ||
      !Array.isArray(raw.contradictions) || typeof raw.feedback !== "string" ||
      !raw.feedback.trim() || raw.feedback.length > 700) throw new Error("Invalid evaluation output");
  const used = [...raw.matched_idea_ids, ...raw.missing_idea_ids];
  if (used.length !== ideas.length || new Set(used).size !== ideas.length || used.some(id => !ideaIds.has(id)))
    throw new Error("Incomplete idea coverage");
  if (raw.contradictions.some(item => !ideaIds.has(item?.idea_id) ||
      typeof item.student_claim !== "string" || typeof item.explanation !== "string"))
    throw new Error("Invalid contradictions");
  if (raw.contradictions.length && raw.verdict !== "Fail") throw new Error("Contradiction must fail");
  if (raw.verdict === "Pass" && raw.missing_idea_ids.length) throw new Error("Pass missed a core idea");
  return raw;
}

async function saveResult(admin, row, verdict, reason, feedback, transcript, details) {
  const result = await admin.rpc("complete_audio_result", { p_attempt_id: row.attempt_id,
    p_verdict: verdict, p_reason: reason, p_feedback: feedback, p_transcript: transcript,
    p_details: details, p_model_id: gemini.MODEL, p_prompt_version: gemini.PROMPT_VERSION });
  if (result.error) throw result.error;
}

async function processAttempt(attemptId, { admin = getAdminSupabase(), model = gemini } = {}) {
  const existing = await admin.from("audio_attempt").select("attempts")
    .eq("attempt_id", attemptId).eq("status", "queued").maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return false;
  const claim = await admin.from("audio_attempt").update({ status: "transcribing",
    lease_until: new Date(Date.now() + 30 * 60000).toISOString(), attempts: existing.data.attempts + 1,
    model_id: gemini.MODEL, prompt_version: gemini.PROMPT_VERSION })
    .eq("attempt_id", attemptId).eq("status", "queued").eq("attempts", existing.data.attempts)
    .select("*").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return false;
  const row = claim.data;
  const heartbeat = setInterval(() => {
    admin.from("audio_attempt").update({ lease_until: new Date(Date.now() + 30 * 60000).toISOString() })
      .eq("attempt_id", attemptId).in("status", ["transcribing", "evaluating"])
      .then(() => {}, () => {});
  }, 60000);
  heartbeat.unref?.();
  try {
    const link = await admin.from("study_run_item").select("item_id,concept_id,study_run(guest_id)")
      .eq("item_id", row.item_id).single();
    if (link.error) throw link.error;
    await liveGuest(link.data.study_run.guest_id, { admin });
    let transcription;
    if (row.speech_state === "clear" && row.transcript?.trim()) {
      transcription = { speech_state: "clear", transcript: row.transcript, unclear_spans: [] };
    } else {
      const bytes = await readAudio({ ...row, study_run_item: { study_run: link.data.study_run } }, admin);
      transcription = await generateValidated(
        () => model.generateJson(model.TRANSCRIBE_PROMPT, {}, model.transcriptionSchema,
          { mimeType: row.file_type, bytes }, { operation: "audio_transcription" }),
        validateTranscript);
      const persisted = await admin.from("audio_attempt").update({ transcript: transcription.transcript,
        speech_state: transcription.speech_state }).eq("attempt_id", attemptId);
      if (persisted.error) throw persisted.error;
    }
    if (transcription.speech_state === "unclear") {
      const unclear = await admin.from("audio_attempt").update({ status: "unclear", error_code: "AUDIO_UNCLEAR",
        lease_until: null }).eq("attempt_id", attemptId);
      if (unclear.error) throw unclear.error;
      return true;
    }
    if (transcription.speech_state === "silent") {
      await saveResult(admin, row, "Fail", "silent", "No explanation was recorded. Please try again.", "", null);
      return true;
    }
    const phase = await admin.from("audio_attempt").update({ status: "evaluating" }).eq("attempt_id", attemptId);
    if (phase.error) throw phase.error;
    const conceptResult = await admin.from("concept").select("concept_id,name,definition,essential_ideas,analogies,examples")
      .eq("concept_id", link.data.concept_id).single();
    if (conceptResult.error) throw conceptResult.error;
    const concept = conceptResult.data;
    const evaluation = await generateValidated(
      () => model.generateJson(model.EVALUATE_PROMPT, {
        CONCEPT_REFERENCE: concept, TRANSCRIPT: transcription.transcript,
      }, model.evaluationSchema, undefined, { operation: "answer_evaluation" }),
      raw => validateEvaluation(raw, concept.essential_ideas));
    await liveGuest(link.data.study_run.guest_id, { admin });
    await saveResult(admin, row, evaluation.verdict, "evaluated", evaluation.feedback,
      transcription.transcript, { matched_idea_ids: evaluation.matched_idea_ids,
        missing_idea_ids: evaluation.missing_idea_ids, contradictions: evaluation.contradictions });
  } catch (error) {
    const current = await admin.from("audio_attempt").select("status").eq("attempt_id", attemptId).maybeSingle();
    if (!current.error && current.data?.status === "completed") return true;
    const safe = new Set(["INVALID_AUDIO", "INVALID_AUDIO_DURATION", "AUDIO_DOWNLOAD_FAILED",
      "MODEL_NOT_CONFIGURED", "MODEL_UNAVAILABLE", "MODEL_RATE_LIMITED", "MODEL_QUOTA_EXCEEDED",
      "MODEL_TIMEOUT", "MODEL_OUTPUT_INVALID",
      "MODEL_REQUEST_INVALID"]);
    const failed = await admin.from("audio_attempt").update({ status: "failed",
      error_code: safe.has(error.code) ? error.code : "PROCESSING_FAILED", lease_until: null })
      .eq("attempt_id", attemptId);
    if (failed.error) throw failed.error;
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

module.exports = { validateAudio, signAttempt, ownedAttempt, attemptView, completeAttempt, cancelAttempt,
  processAttempt, validateDecodedAudio, validateTranscript, validateEvaluation };

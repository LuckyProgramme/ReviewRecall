const crypto = require("crypto");
const getAdminSupabase = require("../adminSupabase");
const { liveGuest } = require("./guestAccess");
const { ApiError, requireUuid } = require("./apiError");
const { extractPdfText } = require("./pdfText");
const { rawTextBlocks } = require("./rawReviewer");
const { curate } = require("./curation");
const gemini = require("./gemini");

const BUCKET = "reviewer_upload";
const RETRYABLE_REVIEWER_ERRORS = new Set(["MODEL_UNAVAILABLE", "MODEL_RATE_LIMITED", "MODEL_QUOTA_EXCEEDED",
  "MODEL_TIMEOUT", "MODEL_NOT_CONFIGURED", "MODEL_OUTPUT_INVALID", "PROCESSING_FAILED"]);
const statusShape = row => ({ reviewer_id: row.reviewer_id, file_name: row.file_name,
  status: row.status, error_code: row.error_code || undefined,
  ...(row.status === "failed" ? { retryable: Number(row.attempts) < 3 && RETRYABLE_REVIEWER_ERRORS.has(row.error_code) } : {}) });

async function ownedReviewer(guestId, reviewerId, admin = getAdminSupabase()) {
  requireUuid(reviewerId, "reviewer ID");
  await liveGuest(guestId, { admin });
  const result = await admin.from("reviewer").select("*")
    .eq("reviewer_id", reviewerId).eq("guest_id", guestId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "REVIEWER_NOT_FOUND", "Reviewer not found");
  return result.data;
}

async function listReviewers(guestId, admin = getAdminSupabase()) {
  await liveGuest(guestId, { admin });
  const result = await admin.from("reviewer").select("reviewer_id,file_name,status,error_code,attempts,created_at")
    .eq("guest_id", guestId).order("created_at", { ascending: false });
  if (result.error) throw result.error;
  return result.data.map(statusShape);
}

async function verifyPdfObject(reviewer, admin) {
  const [folder, name] = reviewer.file_path.split("/");
  if (folder !== reviewer.guest_id || !/^[0-9a-f-]+\.pdf$/i.test(name))
    throw new ApiError(400, "INVALID_UPLOAD", "Upload path is invalid");
  const result = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 100 });
  if (result.error) throw result.error;
  const object = result.data?.find(item => item.name === name && item.id);
  if (!object) throw new ApiError(409, "UPLOAD_MISSING", "Uploaded PDF was not found");
  const size = Number(object.metadata?.size);
  const mime = object.metadata?.mimetype || object.metadata?.contentType;
  if (size !== reviewer.file_size || size > 10 * 1024 * 1024 || (mime && mime !== "application/pdf"))
    throw new ApiError(400, "INVALID_UPLOAD", "Uploaded PDF does not match the signed file");
}

async function completeUpload(guestId, reviewerId, admin = getAdminSupabase()) {
  const reviewer = await ownedReviewer(guestId, reviewerId, admin);
  if (reviewer.status === "failed" && reviewer.attempts < 3 &&
      ["MODEL_UNAVAILABLE", "MODEL_RATE_LIMITED", "MODEL_QUOTA_EXCEEDED", "MODEL_TIMEOUT",
        "MODEL_NOT_CONFIGURED", "MODEL_OUTPUT_INVALID", "PROCESSING_FAILED"].includes(reviewer.error_code)) {
    await liveGuest(guestId, { admin, touch: true });
    const retry = await admin.from("reviewer").update({ status: "queued", error_code: null,
      updated_at: new Date().toISOString() }).eq("reviewer_id", reviewerId).eq("status", "failed")
      .select("*").maybeSingle();
    if (retry.error) throw retry.error;
    return statusShape(retry.data || await ownedReviewer(guestId, reviewerId, admin));
  }
  if (reviewer.status !== "awaiting_upload") return statusShape(reviewer);
  await verifyPdfObject(reviewer, admin);
  await liveGuest(guestId, { admin, touch: true });
  const result = await admin.from("reviewer").update({ status: "queued", updated_at: new Date().toISOString() })
    .eq("reviewer_id", reviewerId).eq("status", "awaiting_upload").select("*").maybeSingle();
  if (result.error) throw result.error;
  return statusShape(result.data || await ownedReviewer(guestId, reviewerId, admin));
}

async function persistTopics(admin, reviewerId, topics) {
  for (const [topicIndex, topic] of topics.entries()) {
    const savedTopic = await admin.from("topic").insert({ reviewer_id: reviewerId, label: topic.label,
      summary: topic.summary, display_order: topicIndex }).select("topic_id").single();
    if (savedTopic.error) throw savedTopic.error;
    for (const [conceptIndex, concept] of topic.concepts.entries()) {
      const savedConcept = await admin.from("concept").insert({ topic_id: savedTopic.data.topic_id,
        name: concept.name, definition: concept.definition.text,
        essential_ideas: concept.essential_ideas.map(idea => ({ idea_id: crypto.randomUUID(), text: idea.text,
          block_ids: idea.block_ids })),
        analogies: concept.analogies.map(item => item.text), examples: concept.examples.map(item => item.text),
        display_order: conceptIndex }).select("concept_id").single();
      if (savedConcept.error) throw savedConcept.error;
      const rows = [];
      for (const [kind, claims] of [["definition", [concept.definition]], ["idea", concept.essential_ideas],
        ["analogy", concept.analogies], ["example", concept.examples]]) {
        claims.forEach((claim, index) => claim.block_ids.forEach(blockId => rows.push({
          concept_id: savedConcept.data.concept_id, block_id: blockId, claim_kind: kind, claim_index: index,
        })));
      }
      const savedEvidence = await admin.from("concept_evidence").insert(rows);
      if (savedEvidence.error) throw savedEvidence.error;
    }
  }
}

async function processReviewer(reviewerId, { admin = getAdminSupabase(), extract = extractPdfText, curateSource = curate } = {}) {
  const existing = await admin.from("reviewer").select("attempts")
    .eq("reviewer_id", reviewerId).eq("status", "queued").maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return false;
  const claim = await admin.from("reviewer").update({ status: "extracting",
    lease_until: new Date(Date.now() + 30 * 60000).toISOString(), updated_at: new Date().toISOString(),
    model_id: gemini.MODEL, prompt_version: gemini.PROMPT_VERSION,
    attempts: existing.data.attempts + 1 })
    .eq("reviewer_id", reviewerId).eq("status", "queued").eq("attempts", existing.data.attempts)
    .select("*").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return false;
  const row = claim.data;
  const heartbeat = setInterval(() => {
    admin.from("reviewer").update({ lease_until: new Date(Date.now() + 30 * 60000).toISOString() })
      .eq("reviewer_id", reviewerId).in("status", ["extracting", "generating"])
      .then(() => {}, () => {});
  }, 60000);
  heartbeat.unref?.();
  try {
    await liveGuest(row.guest_id, { admin });
    let extracted;
    if (row.source_mode === "raw") {
      extracted = rawTextBlocks(row.raw_text || "");
    } else {
      const download = await admin.storage.from(BUCKET).download(row.file_path);
      if (download.error || !download.data) throw Object.assign(new Error("PDF download failed"), { code: "PDF_DOWNLOAD_FAILED" });
      const bytes = Buffer.from(await download.data.arrayBuffer());
      if (bytes.length !== row.file_size) throw Object.assign(new Error("PDF size changed"), { code: "INVALID_UPLOAD" });
      extracted = await extract(bytes);
    }
    if (!extracted.length) throw Object.assign(new Error("No extractable text"), { code: "NO_EXTRACTABLE_TEXT" });
    const oldTopics = await admin.from("topic").delete().eq("reviewer_id", reviewerId);
    if (oldTopics.error) throw oldTopics.error;
    const oldBlocks = await admin.from("source_block").delete().eq("reviewer_id", reviewerId);
    if (oldBlocks.error) throw oldBlocks.error;
    const savedBlocks = await admin.from("source_block").insert(extracted.map(block => ({ ...block,
      reviewer_id: reviewerId }))).select("block_id,page_number,reading_order,heading_path,text_content");
    if (savedBlocks.error) throw savedBlocks.error;
    const phase = await admin.from("reviewer").update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("reviewer_id", reviewerId);
    if (phase.error) throw phase.error;
    const topics = await curateSource(savedBlocks.data);
    if (!topics.some(topic => topic.concepts.length))
      throw Object.assign(new Error("No supported concepts"), { code: "NO_SUPPORTED_CONCEPTS" });
    await persistTopics(admin, reviewerId, topics);
    await liveGuest(row.guest_id, { admin });
    const ready = await admin.from("reviewer").update({ status: "ready", error_code: null,
      lease_until: null, model_id: gemini.MODEL, prompt_version: gemini.PROMPT_VERSION,
      updated_at: new Date().toISOString() }).eq("reviewer_id", reviewerId);
    if (ready.error) throw ready.error;
  } catch (error) {
    const current = await admin.from("reviewer").select("status").eq("reviewer_id", reviewerId).maybeSingle();
    if (!current.error && current.data?.status === "ready") return true;
    const safe = new Set(["NO_EXTRACTABLE_TEXT", "NO_SUPPORTED_CONCEPTS", "PDF_TOO_LARGE",
      "INVALID_PDF", "INVALID_UPLOAD", "MODEL_NOT_CONFIGURED", "MODEL_UNAVAILABLE", "MODEL_RATE_LIMITED",
      "MODEL_QUOTA_EXCEEDED", "MODEL_TIMEOUT",
      "MODEL_OUTPUT_INVALID", "MODEL_REQUEST_INVALID", "PDF_EXTRACTOR_UNAVAILABLE", "PDF_DOWNLOAD_FAILED"]);
    await admin.from("reviewer").update({ status: "failed", error_code: safe.has(error.code) ? error.code : "PROCESSING_FAILED",
      lease_until: null, updated_at: new Date().toISOString() }).eq("reviewer_id", reviewerId);
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

async function getTopics(guestId, reviewerId, admin = getAdminSupabase()) {
  const reviewer = await ownedReviewer(guestId, reviewerId, admin);
  if (reviewer.status !== "ready") throw new ApiError(409, "REVIEWER_NOT_READY", "Reviewer is not ready");
  const result = await admin.from("topic").select("topic_id,label,summary,display_order,concept(concept_id)")
    .eq("reviewer_id", reviewerId).order("display_order");
  if (result.error) throw result.error;
  return result.data.map(topic => ({ topic_id: topic.topic_id, label: topic.label,
    summary: topic.summary, concept_count: topic.concept?.length || 0 }));
}

async function ownedTopic(guestId, topicId, admin = getAdminSupabase()) {
  requireUuid(topicId, "topic ID");
  await liveGuest(guestId, { admin });
  const result = await admin.from("topic").select("topic_id,reviewer_id")
    .eq("topic_id", topicId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
  const owner = await admin.from("reviewer").select("guest_id,status").eq("reviewer_id", result.data.reviewer_id)
    .eq("guest_id", guestId).maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data) throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
  if (owner.data.status !== "ready") throw new ApiError(409, "REVIEWER_NOT_READY", "Reviewer is not ready");
  return result.data;
}

async function getConcepts(guestId, topicId, admin = getAdminSupabase()) {
  await ownedTopic(guestId, topicId, admin);
  const result = await admin.from("concept").select("concept_id,topic_id,name,definition,essential_ideas,analogies,examples,display_order")
    .eq("topic_id", topicId).order("display_order");
  if (result.error) throw result.error;
  const ids = result.data.map(row => row.concept_id);
  const evidence = ids.length ? await admin.from("concept_evidence")
    .select("concept_id,block_id,claim_kind,claim_index,source_block(page_number,heading_path,text_content)")
    .in("concept_id", ids) : { data: [] };
  if (evidence.error) throw evidence.error;
  const locations = new Map();
  const passages = new Map();
  for (const row of evidence.data) {
    const list = locations.get(row.concept_id) || [];
    const key = `${row.source_block?.page_number}:${row.source_block?.heading_path || ""}`;
    if (row.source_block && !list.some(location => `${location.page}:${location.heading || ""}` === key))
      list.push({ page: row.source_block.page_number, heading: row.source_block.heading_path || undefined });
    locations.set(row.concept_id, list);
    if (row.source_block) {
      const conceptPassages = passages.get(row.concept_id) || new Map();
      const passage = conceptPassages.get(row.block_id) || { block_id: row.block_id,
        page: row.source_block.page_number, heading: row.source_block.heading_path || undefined,
        text: row.source_block.text_content, claim_kinds: [] };
      if (!passage.claim_kinds.includes(row.claim_kind)) passage.claim_kinds.push(row.claim_kind);
      conceptPassages.set(row.block_id, passage);
      passages.set(row.concept_id, conceptPassages);
    }
  }
  return result.data.map(row => {
    const ideas = Array.isArray(row.essential_ideas) ? row.essential_ideas
      .filter(idea => typeof idea?.idea_id === "string" && typeof idea?.text === "string")
      .map(idea => ({ idea_id: idea.idea_id, text: idea.text })) : [];
    return { concept_id: row.concept_id, name: row.name,
      reference: { definition: row.definition,
      essential_ideas: ideas.map(idea => idea.text), essential_idea_details: ideas,
      analogies: row.analogies || [], examples: row.examples || [],
      source_locations: locations.get(row.concept_id) || [],
      source_passages: [...(passages.get(row.concept_id)?.values() || [])] } };
  });
}

function referenceMarkdown(topics, conceptGroups) {
  const lines = ["# Review Recall compact reference", ""];
  topics.forEach((topic, index) => {
    lines.push(`## ${topic.label}`, "");
    for (const concept of conceptGroups[index]) {
      const ref = concept.reference;
      lines.push(`### ${concept.name}`, "", ref.definition, "", "Core ideas:");
      ref.essential_ideas.forEach(idea => lines.push(`- ${idea}`));
      if (ref.analogies.length) { lines.push("", "Analogies:"); ref.analogies.forEach(item => lines.push(`- ${item}`)); }
      if (ref.examples.length) { lines.push("", "Examples:"); ref.examples.forEach(item => lines.push(`- ${item}`)); }
      if (ref.source_locations.length) {
        lines.push("", "Source locations:");
        ref.source_locations.forEach(item => lines.push(`- Page ${item.page}${item.heading ? `: ${item.heading}` : ""}`));
      }
      lines.push("");
    }
  });
  return lines.join("\n");
}

module.exports = { ownedReviewer, statusShape, listReviewers, completeUpload, processReviewer,
  getTopics, ownedTopic, getConcepts, referenceMarkdown };

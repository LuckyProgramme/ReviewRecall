const { ApiError, requireUuid } = require("./apiError");
const { liveGuest } = require("./guestAccess");
const getAdminSupabase = require("../adminSupabase");

function validateRaw(input) {
  if (input?.mode !== "raw" || typeof input.text !== "string" || input.file != null)
    throw new ApiError(400, "INVALID_RAW_TEXT", "Provide raw text only");
  const text = input.text.trim();
  if (!text || text.length > 50000 || text.split(/\s+/u).length > 1000)
    throw new ApiError(400, "INVALID_RAW_TEXT", "Provide 1–1,000 words, up to 50,000 characters");
  return { text, key: requireUuid(input.idempotency_key, "idempotency key").toLowerCase() };
}

function rawTextBlocks(text) {
  // Raw input has one logical page. Preserve whitespace and split at word boundaries.
  const parts = text.match(/\S+\s*/gu) || [];
  const blocks = [];
  let chunk = "";
  function flush() {
    if (chunk.trim()) blocks.push({ page_number: 1, reading_order: blocks.length,
      heading_path: "Pasted reviewer", text_content: chunk.trim() });
    chunk = "";
  }
  for (const part of parts) {
    if (chunk && chunk.length + part.length > 1800) flush();
    chunk += part;
  }
  flush();
  return blocks;
}

async function createRawReviewer(guestId, input, admin = getAdminSupabase()) {
  const { text, key } = validateRaw(input);
  await liveGuest(guestId, { admin, touch: true });
  // This path is an idempotency identity; raw content is stored in the reviewer row.
  const path = `${guestId}/${key}.txt`;
  const find = async () => {
    const result = await admin.from("reviewer").select("reviewer_id,raw_text,status")
      .eq("guest_id", guestId).eq("file_path", path).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  };
  let row = await find();
  if (!row) {
    const inserted = await admin.from("reviewer").insert({ guest_id: guestId, file_path: path,
      file_name: "Pasted reviewer", file_type: "text/plain", file_size: Buffer.byteLength(text),
      source_mode: "raw", raw_text: text, status: "queued" })
      .select("reviewer_id,raw_text,status").single();
    if (inserted.error?.code === "23505") row = await find();
    else if (inserted.error) throw inserted.error;
    else row = inserted.data;
  }
  if (!row) throw new Error("Raw reviewer was not saved");
  if (row.raw_text !== text) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Upload key already used for different text");
  return { reviewer_id: row.reviewer_id, status: row.status };
}

module.exports = { createRawReviewer, validateRaw, rawTextBlocks };

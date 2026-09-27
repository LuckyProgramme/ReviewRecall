const getAdminSupabase = require("../adminSupabase");
const { liveGuest } = require("./guestAccess");
const { ApiError, requireUuid, requireString } = require("./apiError");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
function validateFile(input) {
  requireUuid(input?.guest_id, "guest ID");
  const idempotencyKey = requireUuid(input?.idempotency_key, "idempotency key").toLowerCase();
  const name = requireString(input?.file_name, "file name", 255);
  if (!/\.pdf$/i.test(name) || input?.file_type !== "application/pdf") {
    throw new ApiError(400, "INVALID_FILE_TYPE", "Only PDF files are supported");
  }
  if (!Number.isSafeInteger(input?.file_size) || input.file_size < 1 || input.file_size > MAX_FILE_SIZE) {
    throw new ApiError(400, "INVALID_FILE_SIZE", "PDF must be at most 10 MiB");
  }
  return { name, idempotencyKey };
}

function sameUploadMetadata(row, input, name) {
  return row.guest_id === input.guest_id.toLowerCase() && row.file_name === name &&
    row.file_type === "application/pdf" && Number(row.file_size) === input.file_size;
}

async function findByPath(admin, storagePath) {
  const found = await admin.from("reviewer")
    .select("reviewer_id,guest_id,file_path,file_name,file_type,file_size,status")
    .eq("file_path", storagePath).maybeSingle();
  if (found.error) throw found.error;
  return found.data;
}

async function createSignedUpload(input, admin = getAdminSupabase()) {
  const { name, idempotencyKey } = validateFile(input);
  await liveGuest(input.guest_id, { admin });
  const guestId = input.guest_id.toLowerCase();
  const storagePath = `${guestId}/${idempotencyKey}.pdf`;
  let row = await findByPath(admin, storagePath);
  if (!row) {
    const inserted = await admin.from("reviewer").insert({ guest_id: guestId, file_path: storagePath,
      file_name: name, file_type: "application/pdf", file_size: input.file_size })
      .select("reviewer_id,guest_id,file_path,file_name,file_type,file_size,status").single();
    if (inserted.error?.code === "23505") row = await findByPath(admin, storagePath);
    else if (inserted.error) throw inserted.error;
    else row = inserted.data;
  }
  if (!row) throw new Error("Idempotent upload record was not found");
  if (!sameUploadMetadata(row, input, name))
    throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another PDF");
  if (row.status !== "awaiting_upload")
    throw new ApiError(409, "UPLOAD_ALREADY_REGISTERED", "PDF upload was already registered");
  const { data, error } = await admin.storage.from("reviewer_upload").createSignedUploadUrl(storagePath);
  if (error) throw error;
  return { status: row.status, reviewer_id: row.reviewer_id, path: storagePath, token: data.token };
}

module.exports = { createSignedUpload, validateFile, sameUploadMetadata, MAX_FILE_SIZE };

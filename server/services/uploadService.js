const path = require("path");
const crypto = require("crypto");
const supabase = require("../supabase");
const sessionService = require("./sessionService");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["application/pdf"]);

function validateFile({ file_name, file_type, file_size }) {
  if (!file_name || !file_type || !file_size) return "file_name, file_type, and file_size are required";
  if (!ALLOWED_FILE_TYPES.has(file_type)) return "File type not supported";
  if (file_size > MAX_FILE_SIZE) return "File exceeds 10MB";
  return null;
}

async function createSignedUpload({ guest_id, file_name, file_type, file_size }) {
  const validationError = validateFile({ file_name, file_type, file_size });
  if (validationError) return { status: "invalid", error: validationError };
  const session = await sessionService.findSession(guest_id);
  if (!session) return { status: "not_found" };
  if (sessionService.isExpired(session)) return { status: "expired" };
  const storagePath = `${guest_id}/${crypto.randomUUID()}${path.extname(file_name).toLowerCase()}`;
  const { data, error } = await supabase.storage.from("reviewer_upload").createSignedUploadUrl(storagePath);
  if (error) throw error;
  return { status: "ok", path: storagePath, token: data.token };
}

module.exports = { createSignedUpload };

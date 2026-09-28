const getAdminSupabase = require("../adminSupabase");

const BUCKETS = ["reviewer_upload", "reviewer_audio"];
const PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function deleteLegacyRows(admin, guestId) {
  const reviewerIds = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const found = await admin.from("reviewer_upload").select("reviewer_id")
      .eq("session_id", guestId).range(offset, offset + PAGE_SIZE - 1);
    if (found.error) throw found.error;
    reviewerIds.push(...(found.data || []).map(row => row.reviewer_id));
    if (!found.data || found.data.length < PAGE_SIZE) break;
  }
  for (let start = 0; start < reviewerIds.length; start += PAGE_SIZE) {
    const reviewerBatch = reviewerIds.slice(start, start + PAGE_SIZE);
    const extractionIds = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const found = await admin.from("topic_extraction").select("extraction_id")
        .in("reviewer_url", reviewerBatch).range(offset, offset + PAGE_SIZE - 1);
      if (found.error) throw found.error;
      extractionIds.push(...(found.data || []).map(row => row.extraction_id));
      if (!found.data || found.data.length < PAGE_SIZE) break;
    }
    for (let i = 0; i < extractionIds.length; i += PAGE_SIZE) {
      const ids = extractionIds.slice(i, i + PAGE_SIZE);
      const deletedEval = await admin.from("audio_eval").delete().in("topic_url", ids);
      if (deletedEval.error) throw deletedEval.error;
    }
    const deletedExtraction = await admin.from("topic_extraction").delete().in("reviewer_url", reviewerBatch);
    if (deletedExtraction.error) throw deletedExtraction.error;
  }
  const deletedReviewer = await admin.from("reviewer_upload").delete().eq("session_id", guestId);
  if (deletedReviewer.error) throw deletedReviewer.error;
}

async function listSessionFiles(bucket, folder) {
  const paths = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await bucket.list(folder, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const entries = data || [];
    for (const entry of entries) {
      if (!entry.name || entry.name === "." || entry.name === ".." || entry.name.includes("/")) {
        throw new Error("Unexpected storage entry");
      }
      const path = `${folder}/${entry.name}`;
      if (entry.id === null) paths.push(...await listSessionFiles(bucket, path));
      else paths.push(path);
    }
    if (entries.length < PAGE_SIZE) return paths;
  }
}

async function cleanupExpiredSession(guestId, admin) {
  if (!UUID.test(guestId)) return { status: "invalid" };
  admin ??= getAdminSupabase();

  const { data: session, error: findError } = await admin
    .from("guest_session")
    .select("guest_id, expired_at")
    .eq("guest_id", guestId)
    .maybeSingle();
  if (findError) throw findError;
  if (!session) return { status: "not_found" };

  const expiresAt = Date.parse(session.expired_at);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return { status: "active" };
  }

  let deletedFiles = 0;
  for (const bucketName of BUCKETS) {
    const bucket = admin.storage.from(bucketName);
    const paths = await listSessionFiles(bucket, guestId);
    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      const { error } = await bucket.remove(paths.slice(i, i + REMOVE_BATCH_SIZE));
      if (error) throw error;
    }
    deletedFiles += paths.length;
  }

  await deleteLegacyRows(admin, guestId);

  const { data: deleted, error: deleteError } = await admin
    .from("guest_session")
    .delete()
    .eq("guest_id", guestId)
    .lte("expired_at", new Date().toISOString())
    .select("guest_id");
  if (deleteError) throw deleteError;
  if (!deleted?.length) return { status: "not_found" };
  return { status: "deleted", deletedFiles };
}

module.exports = { cleanupExpiredSession, deleteLegacyRows };

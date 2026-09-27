const getAdminSupabase = require("../adminSupabase");
const sessionService = require("./sessionService");

const BUCKET = "reviewer_upload";
const PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOADED_PDF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

async function listReviewerUploads(guestId, { sessions = sessionService, admin } = {}) {
  if (!UUID.test(guestId)) return { status: "invalid" };

  const session = await sessions.findSession(guestId);
  if (!session) return { status: "not_found" };
  if (sessions.isExpired(session)) return { status: "expired" };

  admin ??= getAdminSupabase();
  const bucket = admin.storage.from(BUCKET);
  const uploads = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await bucket.list(guestId, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const entries = data || [];
    for (const entry of entries) {
      if (entry.id === null || !UPLOADED_PDF.test(entry.name)) continue;
      const originalName = entry.metadata?.originalName;
      uploads.push({
        path: `${guestId}/${entry.name}`,
        name: typeof originalName === "string" && originalName.length <= 255 && /\.pdf$/i.test(originalName)
          ? originalName
          : entry.name,
        size: Number.isFinite(entry.metadata?.size) ? entry.metadata.size : null,
        uploaded_at: Number.isFinite(Date.parse(entry.created_at)) ? entry.created_at : null,
      });
    }
    if (entries.length < PAGE_SIZE) break;
  }

  const latestSession = await sessions.findSession(guestId);
  if (!latestSession) return { status: "not_found" };
  if (sessions.isExpired(latestSession)) return { status: "expired" };
  uploads.sort((a, b) =>
    (Date.parse(b.uploaded_at) || 0) - (Date.parse(a.uploaded_at) || 0) ||
    a.path.localeCompare(b.path));
  return { status: "ok", uploads };
}

module.exports = { listReviewerUploads };

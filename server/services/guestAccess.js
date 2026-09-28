const getAdminSupabase = require("../adminSupabase");
const sessionService = require("./sessionService");
const { ApiError, requireUuid } = require("./apiError");

async function liveGuest(guestId, { touch = false, admin = getAdminSupabase() } = {}) {
  requireUuid(guestId, "guest ID");
  const { data, error } = await admin.from("guest_session")
    .select("guest_id,expired_at").eq("guest_id", guestId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "SESSION_NOT_FOUND", "Session not found");
  if (sessionService.isExpired(data)) throw new ApiError(410, "SESSION_EXPIRED", "Session expired");
  if (!touch) return data;
  const now = new Date();
  const expires = new Date(now.getTime() + sessionService.SESSION_DURATION_MS).toISOString();
  const updated = await admin.from("guest_session").update({ expired_at: expires })
    .eq("guest_id", guestId).gt("expired_at", now.toISOString())
    .select("guest_id,expired_at").maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) throw new ApiError(410, "SESSION_EXPIRED", "Session expired");
  return updated.data;
}

function guestHeader(req) {
  return requireUuid(req.get("X-Guest-Id"), "guest credential");
}

module.exports = { liveGuest, guestHeader };

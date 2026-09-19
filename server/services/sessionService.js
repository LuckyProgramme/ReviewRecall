const supabase = require("../supabase");
const SESSION_DURATION_MS = 30 * 60 * 1000;
const SESSION_FIELDS = "guest_id, created_at, expired_at";
const getExpiry = () => new Date(Date.now() + SESSION_DURATION_MS).toISOString();

async function createSession() {
  const { data, error } = await supabase.from("guest_session").insert({ expired_at: getExpiry() }).select(SESSION_FIELDS).single();
  if (error) throw error;
  return data;
}

async function findSession(guestId) {
  const { data, error } = await supabase.from("guest_session").select(SESSION_FIELDS).eq("guest_id", guestId).maybeSingle();
  if (error) throw error;
  return data;
}

const isExpired = (session) => !session?.expired_at || new Date(session.expired_at).getTime() <= Date.now();

async function refreshSession(guestId) {
  const session = await findSession(guestId);
  if (!session) return { status: "not_found" };
  if (isExpired(session)) return { status: "expired" };
  const { data, error } = await supabase.from("guest_session").update({ expired_at: getExpiry() }).eq("guest_id", guestId).select(SESSION_FIELDS).single();
  if (error) throw error;
  return { status: "ok", session: data };
}

module.exports = { createSession, findSession, isExpired, refreshSession };

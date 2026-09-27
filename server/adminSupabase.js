require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

let adminClient;

function isServerSecret(key) {
  if (key.startsWith("sb_secret_")) return true;
  try {
    const payload = key.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

function getAdminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !isServerSecret(key)) {
    const error = new Error("Server-only Supabase credentials are required for cleanup");
    error.code = "CLEANUP_NOT_CONFIGURED";
    throw error;
  }
  adminClient ??= createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}

module.exports = getAdminSupabase;

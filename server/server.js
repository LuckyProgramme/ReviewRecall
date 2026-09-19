const express = require("express");
const cors = require("cors");
const sessionService = require("./services/sessionService");
const uploadService = require("./services/uploadService");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/sessions", async (req, res) => {
  try {
    const session = await sessionService.createSession();
    res.status(201).json({ session_id: session.guest_id, created_at: session.created_at, expired_at: session.expired_at });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sessions/:guest_id", async (req, res) => {
  try {
    const session = await sessionService.findSession(req.params.guest_id);
    if (!session) return res.status(404).json({ valid: false, error: "Session not found" });
    if (sessionService.isExpired(session)) return res.status(410).json({ valid: false, error: "Session expired" });
    res.json({ valid: true, ...session });
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

app.patch("/api/sessions/:guest_id/activity", async (req, res) => {
  try {
    const result = await sessionService.refreshSession(req.params.guest_id);
    if (result.status === "not_found") return res.status(404).json({ valid: false, error: "Session not found" });
    if (result.status === "expired") return res.status(410).json({ valid: false, error: "Session expired" });
    res.json({ valid: true, ...result.session });
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

app.post("/api/uploads/sign", async (req, res) => {
  try {
    const result = await uploadService.createSignedUpload(req.body);
    if (result.status === "invalid") return res.status(400).json({ error: result.error });
    if (result.status === "not_found") return res.status(404).json({ error: "Session not found" });
    if (result.status === "expired") return res.status(410).json({ error: "Session expired" });
    res.status(201).json({ path: result.path, token: result.token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running at port ${PORT}`));
}

module.exports = app;

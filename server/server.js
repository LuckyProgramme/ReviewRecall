const express = require("express");
const cors = require("cors");
const sessionService = require("./services/sessionService");
const uploadService = require("./services/uploadService");
const expiredSessionCleanup = require("./services/expiredSessionCleanup");
const reviewerUploads = require("./services/reviewerUploads");
const reviewerRoutes = require("./routes/reviewerRoutes");
const { ApiError } = require("./services/apiError");
const { guestHeader } = require("./services/guestAccess");

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
    res.status(503).json({ error: "Session service unavailable", code: "DEPENDENCY_UNAVAILABLE" });
  }
});

app.get("/api/sessions/:guest_id", async (req, res) => {
  try {
    const session = await sessionService.findSession(req.params.guest_id);
    if (!session) return res.status(404).json({ valid: false, error: "Session not found" });
    if (sessionService.isExpired(session)) return res.status(410).json({ valid: false, error: "Session expired" });
    res.json({ valid: true, ...session });
  } catch (error) {
    res.status(503).json({ valid: false, error: "Session service unavailable", code: "DEPENDENCY_UNAVAILABLE" });
  }
});

app.patch("/api/sessions/:guest_id/activity", async (req, res) => {
  try {
    const result = await sessionService.refreshSession(req.params.guest_id);
    if (result.status === "not_found") return res.status(404).json({ valid: false, error: "Session not found" });
    if (result.status === "expired") return res.status(410).json({ valid: false, error: "Session expired" });
    res.json({ valid: true, ...result.session });
  } catch (error) {
    res.status(503).json({ valid: false, error: "Session service unavailable", code: "DEPENDENCY_UNAVAILABLE" });
  }
});

app.delete("/api/sessions/:guest_id/expired", async (req, res) => {
  try {
    const result = await expiredSessionCleanup.cleanupExpiredSession(req.params.guest_id);
    if (result.status === "invalid") return res.status(400).json({ error: "Invalid session ID" });
    if (result.status === "not_found") return res.json({ deleted: true, deleted_files: 0, already_removed: true });
    if (result.status === "active") return res.status(409).json({ error: "Session is still active" });
    res.json({ deleted: true, deleted_files: result.deletedFiles });
  } catch (error) {
    if (error.code === "CLEANUP_NOT_CONFIGURED") {
      return res.status(503).json({ error: "Session cleanup is not configured" });
    }
    res.status(500).json({ error: "Session cleanup failed" });
  }
});

app.get("/api/sessions/:guest_id/uploads", async (req, res) => {
  try {
    const credential = guestHeader(req);
    if (credential !== req.params.guest_id.toLowerCase()) {
      return res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
    }
    const result = await reviewerUploads.listReviewerUploads(credential);
    if (result.status === "invalid") return res.status(400).json({ error: "Invalid session ID" });
    if (result.status === "not_found") return res.status(404).json({ error: "Session not found" });
    if (result.status === "expired") return res.status(410).json({ error: "Session expired" });
    res.json({ uploads: result.uploads });
  } catch (error) {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error.code === "CLEANUP_NOT_CONFIGURED") {
      return res.status(503).json({ error: "Upload listing is not configured" });
    }
    res.status(500).json({ error: "Upload listing failed" });
  }
});

app.post("/api/uploads/sign", async (req, res) => {
  try {
    if (req.get("X-Guest-Id") && req.get("X-Guest-Id") !== req.body?.guest_id) {
      return res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
    }
    const result = await uploadService.createSignedUpload(req.body);
    res.status(201).json({ path: result.path, token: result.token, reviewer_id: result.reviewer_id });
  } catch (error) {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message, code: error.code });
    res.status(503).json({ error: "Upload signing unavailable", code: "DEPENDENCY_UNAVAILABLE" });
  }
});

app.use("/api", reviewerRoutes);
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message, code: error.code });
  res.status(503).json({ error: "Service temporarily unavailable", code: "DEPENDENCY_UNAVAILABLE" });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running at port ${PORT}`));
  require("./services/jobWorker").startWorker();
}

module.exports = app;

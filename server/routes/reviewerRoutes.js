const express = require("express");
const { guestHeader, liveGuest } = require("../services/guestAccess");
const { ApiError, requireUuid } = require("../services/apiError");
const reviewer = require("../services/reviewerService");
const runs = require("../services/runService");
const attempts = require("../services/attemptService");

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.post("/uploads/complete", wrap(async (req, res) => {
  const result = await reviewer.completeUpload(guestHeader(req), requireUuid(req.body?.reviewer_id, "reviewer ID"));
  res.json(result);
}));
router.get("/sessions/:guest_id/reviewers", wrap(async (req, res) => {
  const guestId = guestHeader(req);
  if (guestId !== req.params.guest_id) throw new ApiError(404, "SESSION_NOT_FOUND", "Session not found");
  res.json({ reviewers: await reviewer.listReviewers(guestId) });
}));
router.get("/reviewers/:reviewer_id/status", wrap(async (req, res) => {
  res.json(reviewer.statusShape(await reviewer.ownedReviewer(guestHeader(req), req.params.reviewer_id)));
}));
router.get("/reviewers/:reviewer_id/topics", wrap(async (req, res) => {
  res.json({ topics: await reviewer.getTopics(guestHeader(req), req.params.reviewer_id) });
}));
router.get("/topics/:topic_id/concepts", wrap(async (req, res) => {
  res.json({ concepts: await reviewer.getConcepts(guestHeader(req), req.params.topic_id) });
}));
router.get("/reviewers/:reviewer_id/reference", wrap(async (req, res) => {
  const guestId = guestHeader(req);
  const row = await reviewer.ownedReviewer(guestId, req.params.reviewer_id);
  if (row.status !== "ready") throw new ApiError(409, "REVIEWER_NOT_READY", "Reviewer is not ready");
  const topics = await reviewer.getTopics(guestId, row.reviewer_id);
  const selected = req.query.topic_id
    ? topics.filter(topic => topic.topic_id === requireUuid(req.query.topic_id, "topic ID")) : topics;
  if (!selected.length) throw new ApiError(404, "TOPIC_NOT_FOUND", "Topic not found");
  const groups = await Promise.all(selected.map(topic => reviewer.getConcepts(guestId, topic.topic_id)));
  res.set("Content-Type", "text/markdown; charset=utf-8");
  res.set("Content-Disposition", "attachment; filename=review-recall-reference.md");
  res.send(reviewer.referenceMarkdown(selected, groups));
}));
router.post("/topics/:topic_id/runs", wrap(async (req, res) => {
  res.status(201).json({ run: await runs.startRun(guestHeader(req), req.params.topic_id) });
}));
router.get("/runs/:run_id", wrap(async (req, res) => {
  res.json({ run: await runs.runView(guestHeader(req), req.params.run_id) });
}));
router.post("/runs/:run_id/advance", wrap(async (req, res) => {
  res.json({ run: await runs.advance(guestHeader(req), req.params.run_id,
    requireUuid(req.body?.item_id, "item ID")) });
}));
router.post("/runs/:run_id/items/:item_id/skip", wrap(async (req, res) => {
  res.json({ run: await runs.skip(guestHeader(req), req.params.run_id, req.params.item_id) });
}));
router.post("/runs/:run_id/items/:item_id/attempts/sign", wrap(async (req, res) => {
  res.status(201).json(await attempts.signAttempt(guestHeader(req), req.params.run_id,
    req.params.item_id, req.body));
}));
router.post("/attempts/:attempt_id/complete", wrap(async (req, res) => {
  res.json({ attempt: await attempts.completeAttempt(guestHeader(req), req.params.attempt_id) });
}));
router.post("/attempts/:attempt_id/cancel", wrap(async (req, res) => {
  res.json({ attempt: await attempts.cancelAttempt(guestHeader(req), req.params.attempt_id) });
}));
router.get("/attempts/:attempt_id", wrap(async (req, res) => {
  res.json({ attempt: attempts.attemptView(await attempts.ownedAttempt(guestHeader(req), req.params.attempt_id)) });
}));
router.get("/runs/:run_id/summary", wrap(async (req, res) => {
  res.json({ summary: await runs.summary(guestHeader(req), req.params.run_id) });
}));

module.exports = router;

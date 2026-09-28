const assert = require("node:assert/strict");
const { test } = require("node:test");
const { selectConcept } = require("./runService");
const guest = "123e4567-e89b-42d3-a456-426614174000";
const runId = "223e4567-e89b-42d3-a456-426614174000";
const conceptId = "323e4567-e89b-42d3-a456-426614174000";

function adminFor(result, owner = true) {
  const calls = [];
  const admin = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, gt() { return this; }, update() { return this; },
        async maybeSingle() {
          if (table === "guest_session") return { data: { guest_id: guest, expired_at: new Date(Date.now() + 60000).toISOString() } };
          if (table === "study_run") return { data: owner ? { run_id: runId, guest_id: guest } : null };
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { data: result }; },
  };
  return { admin, calls };
}

test("concept selection rejects foreign runs before calling the cursor RPC", async () => {
  const { admin, calls } = adminFor("selected", false);
  await assert.rejects(selectConcept(guest, runId, conceptId, admin), { code: "RUN_NOT_FOUND" });
  assert.equal(calls.length, 0);
});

test("concept selection sends the exact displayed concept and maps active recording conflicts", async () => {
  const { admin, calls } = adminFor("attempt_in_progress");
  await assert.rejects(selectConcept(guest, runId, conceptId, admin), { status: 409, code: "ATTEMPT_IN_PROGRESS" });
  assert.deepEqual(calls, [{ name: "select_study_concept", args: { p_guest_id: guest, p_run_id: runId, p_concept_id: conceptId } }]);
});

test("selection handles expired sessions and concepts outside the run", async () => {
  for (const [result, code] of [["session_expired", "SESSION_EXPIRED"], ["concept_not_found", "CONCEPT_NOT_FOUND"]]) {
    await assert.rejects(selectConcept(guest, runId, conceptId, adminFor(result).admin), { code });
  }
});

test("selection rejects malformed concept IDs before accessing data", async () => {
  await assert.rejects(selectConcept(guest, runId, "not-an-id", {}), { code: "INVALID_INPUT" });
});

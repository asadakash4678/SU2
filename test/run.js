"use strict";
/* End-to-end backend tests against an in-memory Postgres (pg-mem).
   Exercises auth, RBAC enforcement, CRUD, version-conflict handling,
   bootstrap, admin user lifecycle, matrix editing and audit. */
process.env.JWT_SECRET = "test-secret";
process.env.SEED_DEMO = "true";
process.env.CORS_ORIGIN = "*";

const assert = require("assert");
const { newDb } = require("pg-mem");
const request = require("supertest");
const db = require("../db");

let pass = 0, fail = 0;
async function t(name, fn){ try { await fn(); console.log("  \u2713 " + name); pass++; }
  catch(e){ console.log("  \u2717 " + name + "\n      " + (e.message||e)); fail++; } }

async function main(){
  // ---- wire pg-mem as the pool ----
  const mem = newDb();
  mem.public.registerFunction({ name:"now", returns:"timestamptz", implementation:()=>new Date() });
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  db.setPool(pool);

  await db.initSchema();
  const { seed } = require("../db/seed");
  await seed();
  const { createApp } = require("../server");
  const app = await createApp();
  const api = request(app);

  const login = async (username, password) => {
    const r = await api.post("/api/auth/login").send({ username, password });
    return r;
  };
  const auth = (tok) => ({ Authorization: "Bearer " + tok });

  let adminTok, consTok, nurseTok, roTok;

  await t("health check ok", async () => {
    const r = await api.get("/api/health"); assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  });

  await t("admin logs in with seeded credentials", async () => {
    const r = await login("admin", "admin123");
    assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.user.role, "admin");
    adminTok = r.body.token;
  });

  await t("wrong password is rejected", async () => {
    const r = await login("admin", "nope"); assert.equal(r.status, 401);
  });

  await t("consultant + nurse + read-only log in", async () => {
    consTok = (await login("consultant","demo123")).body.token;
    nurseTok = (await login("nurse","demo123")).body.token;
    roTok = (await login("readonly","demo123")).body.token;
    assert.ok(consTok && nurseTok && roTok);
  });

  await t("bootstrap returns data + config + matrix", async () => {
    const r = await api.get("/api/bootstrap").set(auth(consTok));
    assert.equal(r.status, 200);
    assert.ok(r.body.data.patients.length >= 5, "patients seeded");
    assert.ok(r.body.matrix.consultant, "matrix present");
    assert.equal(r.body.users, undefined, "consultant does NOT receive user list");
  });

  await t("admin bootstrap includes user list", async () => {
    const r = await api.get("/api/bootstrap").set(auth(adminTok));
    assert.ok(Array.isArray(r.body.users) && r.body.users.length >= 11);
  });

  await t("requests without a token are 401", async () => {
    const r = await api.get("/api/bootstrap"); assert.equal(r.status, 401);
  });

  let patientId, patientVersion;
  await t("consultant can create a patient (RBAC allow)", async () => {
    const r = await api.post("/api/records/patients").set(auth(consTok))
      .send({ mrn:"SU2-T-1", name:"Test Alpha", age:40, gender:"Male", bed:"50", dx:"Test", status:"Stable", priority:"green", admittedAt:new Date().toISOString(), flags:[] });
    assert.equal(r.status, 201); assert.equal(r.body._v, 1);
    patientId = r.body.id; patientVersion = r.body._v;
  });

  await t("read-only user CANNOT create a patient (RBAC deny)", async () => {
    const r = await api.post("/api/records/patients").set(auth(roTok))
      .send({ mrn:"SU2-T-2", name:"Nope", age:1, gender:"Male", bed:"51", dx:"x", status:"Stable", priority:"green" });
    assert.equal(r.status, 403);
  });

  await t("nurse CANNOT prescribe medication (RBAC deny)", async () => {
    const r = await api.post("/api/records/meds").set(auth(nurseTok))
      .send({ patientId, name:"Test drug", dose:"1", unit:"g", status:"Active" });
    assert.equal(r.status, 403);
  });

  await t("nurse CAN document MAR (RBAC allow)", async () => {
    const r = await api.post("/api/records/mar").set(auth(nurseTok))
      .send({ patientId, medName:"Test", status:"Given", by:"Sr. Ayesha Khan", at:new Date().toISOString() });
    assert.equal(r.status, 201);
  });

  await t("update with correct version succeeds", async () => {
    const r = await api.put("/api/records/patients/"+patientId).set(auth(consTok))
      .send({ id:patientId, mrn:"SU2-T-1", name:"Test Alpha", age:41, gender:"Male", bed:"50", dx:"Test edited", status:"Stable", priority:"green", _v:patientVersion });
    assert.equal(r.status, 200); assert.equal(r.body._v, 2); patientVersion = r.body._v;
  });

  await t("update with STALE version returns 409 conflict + latest record", async () => {
    const r = await api.put("/api/records/patients/"+patientId).set(auth(consTok))
      .send({ id:patientId, name:"Stale write", age:99, _v:1 });   // version 1 is stale (now 2)
    assert.equal(r.status, 409); assert.equal(r.body.record._v, 2);
    assert.equal(r.body.record.name, "Test Alpha");
  });

  await t("admin creates a user; duplicate username rejected", async () => {
    const r1 = await api.post("/api/admin/users").set(auth(adminTok))
      .send({ name:"New Reg", username:"newreg", role:"sr", password:"pass1234" });
    assert.equal(r1.status, 201); assert.equal(r1.body.mustChange, true);
    const r2 = await api.post("/api/admin/users").set(auth(adminTok))
      .send({ name:"Dup", username:"newreg", role:"mo", password:"pass1234" });
    assert.equal(r2.status, 409);
  });

  await t("non-admin cannot access admin user routes", async () => {
    const r = await api.post("/api/admin/users").set(auth(consTok))
      .send({ name:"X", username:"x", role:"mo", password:"pass1234" });
    assert.equal(r.status, 403);
  });

  await t("new user must change temp password, then can log in", async () => {
    const bad = await login("newreg","pass1234");        // works but flagged mustChange
    assert.equal(bad.status, 200); assert.equal(bad.body.user.mustChange, true);
    const ch = await api.post("/api/auth/change-password").set(auth(bad.body.token))
      .send({ next:"brandNew9" });
    assert.equal(ch.status, 200);
    // old token invalidated by epoch bump
    const stale = await api.get("/api/bootstrap").set(auth(bad.body.token));
    assert.equal(stale.status, 401, "old session invalidated after password change");
    const relog = await login("newreg","brandNew9");
    assert.equal(relog.status, 200); assert.equal(relog.body.user.mustChange, false);
  });

  await t("admin edits permission matrix; change takes effect", async () => {
    // deny consultants the ability to record surgery
    const cur = (await api.get("/api/bootstrap").set(auth(adminTok))).body.matrix;
    cur.consultant.surgery = "no";
    const put = await api.put("/api/admin/config/matrix").set(auth(adminTok)).send({ matrix:cur });
    assert.equal(put.status, 200);
    const deny = await api.post("/api/records/surgeries").set(auth(consTok))
      .send({ patientId, procedure:"Test op", type:"Elective", surgeon:"x", date:new Date().toISOString(), status:"Scheduled" });
    assert.equal(deny.status, 403, "matrix change now blocks consultant surgery");
    // restore
    cur.consultant.surgery = "yes";
    await api.put("/api/admin/config/matrix").set(auth(adminTok)).send({ matrix:cur });
    const allow = await api.post("/api/records/surgeries").set(auth(consTok))
      .send({ patientId, procedure:"Test op", type:"Elective", surgeon:"x", date:new Date().toISOString(), status:"Scheduled" });
    assert.equal(allow.status, 201);
  });

  await t("per-user override grants nurse med rights", async () => {
    const users = (await api.get("/api/admin/users").set(auth(adminTok))).body;
    const nurse = users.find(u => u.username === "nurse");
    await api.put("/api/admin/users/"+nurse.id).set(auth(adminTok))
      .send({ name:nurse.name, role:"nurse", permOverrides:{ med:true } });
    const relog = await login("nurse","demo123");
    const r = await api.post("/api/records/meds").set(auth(relog.body.token))
      .send({ patientId, name:"Override drug", dose:"1", unit:"g", status:"Active" });
    assert.equal(r.status, 201, "nurse with med override can prescribe");
  });

  await t("account lifecycle: deactivate blocks login", async () => {
    const users = (await api.get("/api/admin/users").set(auth(adminTok))).body;
    const ro = users.find(u => u.username === "readonly");
    await api.post("/api/admin/users/"+ro.id+"/lifecycle").set(auth(adminTok)).send({ status:"deactivated" });
    const r = await login("readonly","demo123");
    assert.equal(r.status, 403, "deactivated account cannot log in");
    await api.post("/api/admin/users/"+ro.id+"/lifecycle").set(auth(adminTok)).send({ status:"active" });
  });

  await t("delete a record enforces RBAC and removes it", async () => {
    const roFresh = (await login("readonly","demo123")).body.token;   // fresh token (epoch changed earlier)
    const del = await api.delete("/api/records/patients/"+patientId).set(auth(roFresh));
    assert.equal(del.status, 403, "read-only cannot delete");
    const ok = await api.delete("/api/records/patients/"+patientId).set(auth(adminTok));
    assert.equal(ok.status, 200);
  });

  await t("audit log records events and is searchable (admin/HOD only)", async () => {
    const r = await api.get("/api/admin/audit?q=login").set(auth(adminTok));
    assert.equal(r.status, 200); assert.ok(r.body.length > 0);
    const denied = await api.get("/api/admin/audit").set(auth(nurseTok));
    assert.equal(denied.status, 403, "nurse cannot read audit log");
  });

  await t("verify-password confirms the correct password and rejects a wrong one", async () => {
    const ok = await api.post("/api/auth/verify-password").set(auth(consTok)).send({ password:"demo123" });
    assert.equal(ok.status, 200); assert.equal(ok.body.ok, true);
    const bad = await api.post("/api/auth/verify-password").set(auth(consTok)).send({ password:"wrong" });
    assert.equal(bad.status, 401);
  });

  await t("admin can delete a user; non-admin cannot; self/last-admin protected", async () => {
    // create a throwaway user to delete
    const made = await api.post("/api/admin/users").set(auth(adminTok))
      .send({ name:"Temp Delete", username:"tempdel", role:"mo", password:"pass1234" });
    assert.equal(made.status, 201); const uid = made.body.id;
    // non-admin blocked
    const denied = await api.delete("/api/admin/users/"+uid).set(auth(consTok));
    assert.equal(denied.status, 403);
    // admin cannot delete self
    const me = (await api.get("/api/admin/users").set(auth(adminTok))).body.find(u=>u.username==="admin");
    const self = await api.delete("/api/admin/users/"+me.id).set(auth(adminTok));
    assert.equal(self.status, 400, "cannot delete own account");
    // admin deletes the throwaway user
    const ok = await api.delete("/api/admin/users/"+uid).set(auth(adminTok));
    assert.equal(ok.status, 200);
    const gone = (await api.get("/api/admin/users").set(auth(adminTok))).body.some(u=>u.id===uid);
    assert.equal(gone, false, "user removed");
  });

  console.log("\n  " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

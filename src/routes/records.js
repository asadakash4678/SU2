"use strict";
const express = require("express");
const db = require("../../db");
const { requireAuth } = require("../auth");
const { can, COLLECTION_PERM } = require("../rbac");
const { getConfig, getMatrix, writeAudit, rid } = require("../store");
const { broadcast } = require("../realtime");
const { mapUser, reqMeta } = require("./auth");

const router = express.Router();
const COLLECTIONS = ["patients","notes","surgeries","meds","mar","labs","io","drains","orders","tasks","chat","photos","timeline","notifications"];

// GET /api/bootstrap — everything the client needs to render after login
router.get("/bootstrap", requireAuth, async (req,res) => {
  const recs = await db.query("SELECT id,collection,data,version FROM records ORDER BY updated_at ASC");
  const data = {}; COLLECTIONS.forEach(c => data[c] = []);
  recs.rows.forEach(r => { (data[r.collection] = data[r.collection] || []).push({ ...r.data, _v:r.version }); });
  const cfg = await getConfig();
  const out = { me: mapUser(req.user), config: cfg.settings, matrix: cfg.matrix, data };
  if(can(req.user, "userMgmt", cfg.matrix)){
    const us = await db.query("SELECT * FROM users ORDER BY created_at ASC");
    out.users = us.rows.map(mapUser);
  }
  res.json(out);
});

// permission required to write a given collection
function writePerm(collection, isCreate){
  if(collection === "patients") return isCreate ? "addPatient" : "editPatient";
  return COLLECTION_PERM[collection]; // may be null (timeline/notifications: informational)
}

async function ensureCan(req,res,collection,isCreate){
  const perm = writePerm(collection, isCreate);
  if(perm === null || perm === undefined) return true;        // informational collections
  const matrix = await getMatrix();
  if(!can(req.user, perm, matrix)){ res.status(403).json({ error:"Not permitted" }); return false; }
  return true;
}

// POST /api/records/:collection  — create
router.post("/records/:collection", requireAuth, async (req,res) => {
  const c = req.params.collection;
  if(!COLLECTIONS.includes(c)) return res.status(404).json({ error:"Unknown collection" });
  if(!(await ensureCan(req,res,c,true))) return;
  const obj = req.body || {};
  obj.id = obj.id || rid();
  await db.query(
    "INSERT INTO records(id,collection,data,version,updated_by) VALUES($1,$2,$3,1,$4)",
    [obj.id, c, JSON.stringify(obj), req.user.name]
  );
  const record = { ...obj, _v:1 };
  broadcast(c, "upsert", { record });
  res.status(201).json(record);
});

// PUT /api/records/:collection/:id  — update with version check (§ conflict handling)
router.put("/records/:collection/:id", requireAuth, async (req,res) => {
  const c = req.params.collection, id = req.params.id;
  if(!COLLECTIONS.includes(c)) return res.status(404).json({ error:"Unknown collection" });
  if(!(await ensureCan(req,res,c,false))) return;
  const body = req.body || {};
  const expected = Number(body._v);
  const obj = { ...body }; delete obj._v; obj.id = id;

  const cur = await db.query("SELECT version,data FROM records WHERE id=$1 AND collection=$2", [id, c]);
  if(cur.rowCount === 0) return res.status(404).json({ error:"Record not found" });

  if(Number.isFinite(expected)){
    const upd = await db.query(
      `UPDATE records SET data=$3, version=version+1, updated_at=now(), updated_by=$4
       WHERE id=$1 AND collection=$2 AND version=$5 RETURNING version`,
      [id, c, JSON.stringify(obj), req.user.name, expected]
    );
    if(upd.rowCount === 0){
      // someone else changed it first — return current server state for reconciliation
      const latest = cur.rows[0];
      return res.status(409).json({ error:"conflict", record:{ ...latest.data, _v:latest.version } });
    }
    const record = { ...obj, _v:upd.rows[0].version };
    broadcast(c, "upsert", { record });
    return res.json(record);
  } else {
    // no version supplied → last-write-wins (still bumps version)
    const upd = await db.query(
      `UPDATE records SET data=$3, version=version+1, updated_at=now(), updated_by=$4
       WHERE id=$1 AND collection=$2 RETURNING version`,
      [id, c, JSON.stringify(obj), req.user.name]
    );
    const record = { ...obj, _v:upd.rows[0].version };
    broadcast(c, "upsert", { record });
    return res.json(record);
  }
});

// DELETE /api/records/:collection/:id
router.delete("/records/:collection/:id", requireAuth, async (req,res) => {
  const c = req.params.collection, id = req.params.id;
  if(!COLLECTIONS.includes(c)) return res.status(404).json({ error:"Unknown collection" });
  const perm = c === "patients" ? "deletePatient" : writePerm(c,false);
  if(perm){ const matrix = await getMatrix(); if(!can(req.user, perm, matrix)) return res.status(403).json({ error:"Not permitted" }); }
  await db.query("DELETE FROM records WHERE id=$1 AND collection=$2", [id, c]);
  broadcast(c, "delete", { id });
  res.json({ ok:true, id });
});

// POST /api/audit — record a client-side action (identity is server-stamped, not trusted from client)
router.post("/audit", requireAuth, async (req,res) => {
  const { action, detail } = req.body || {};
  if(!action) return res.status(400).json({ error:"action required" });
  const entry = await writeAudit(req.user, String(action).slice(0,120), String(detail||"").slice(0,300), reqMeta(req));
  res.status(201).json(entry);
});

module.exports = { router, COLLECTIONS };

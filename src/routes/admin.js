"use strict";
const express = require("express");
const db = require("../../db");
const { requireAuth, hashPw } = require("../auth");
const { can, ROLES, ROLE_ORDER, buildDefaultMatrix } = require("../rbac");
const { getConfig, getMatrix, setConfigKey, writeAudit, rid } = require("../store");
const { broadcastUsers, broadcastConfig } = require("../realtime");
const { mapUser, reqMeta } = require("./auth");

const router = express.Router();

async function requireAdmin(req,res,next){
  const matrix = await getMatrix();
  if(!can(req.user, "userMgmt", matrix)) return res.status(403).json({ error:"Administrator access required" });
  next();
}
async function requireAudit(req,res,next){
  const matrix = await getMatrix();
  if(!can(req.user, "auditView", matrix)) return res.status(403).json({ error:"Not permitted" });
  next();
}

// ---- Users ----
router.get("/users", requireAuth, requireAdmin, async (req,res) => {
  const r = await db.query("SELECT * FROM users ORDER BY created_at ASC");
  res.json(r.rows.map(mapUser));
});

router.post("/users", requireAuth, requireAdmin, async (req,res) => {
  const b = req.body || {};
  const cfg = await getConfig();
  const minLen = (cfg.settings && cfg.settings.pwMinLen) || 8;
  if(!b.name || !b.username) return res.status(400).json({ error:"Name and username required" });
  if(!ROLE_ORDER.includes(b.role)) return res.status(400).json({ error:"Invalid role" });
  const pw = b.password || "temp1234";
  if(pw.length < minLen || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw))
    return res.status(400).json({ error:"Temporary password too weak (min "+minLen+", letter + digit)" });
  const un = String(b.username).toLowerCase();
  const dup = await db.query("SELECT 1 FROM users WHERE username=$1", [un]);
  if(dup.rowCount) return res.status(409).json({ error:"Username already taken" });
  const id = rid(); const hash = await hashPw(pw);
  await db.query(
    `INSERT INTO users(id,username,name,role,desig,emp,contact,email,pw_hash,status,must_change,perm_overrides,session_epoch,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',true,$10,0,$11)`,
    [id, un, b.name, b.role, b.desig || ROLES[b.role].label, b.emp||"", b.contact||"", b.email||"", hash, JSON.stringify(b.permOverrides||{}), req.user.name]
  );
  await writeAudit(req.user, "Account creation", b.name+" ("+ROLES[b.role].label+")", reqMeta(req));
  await writeAudit(req.user, "Account activation", b.name, reqMeta(req));
  broadcastUsers();
  const u = (await db.query("SELECT * FROM users WHERE id=$1",[id])).rows[0];
  res.status(201).json(mapUser(u));
});

router.put("/users/:id", requireAuth, requireAdmin, async (req,res) => {
  const b = req.body || {};
  const cur = (await db.query("SELECT * FROM users WHERE id=$1",[req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"User not found" });
  const isAdminAcct = cur.role === "admin";
  const role = isAdminAcct ? "admin" : (ROLE_ORDER.includes(b.role) ? b.role : cur.role);
  const overrides = isAdminAcct ? cur.perm_overrides : (b.permOverrides || {});
  await db.query(
    `UPDATE users SET name=$2, role=$3, desig=$4, emp=$5, contact=$6, email=$7, perm_overrides=$8 WHERE id=$1`,
    [cur.id, b.name||cur.name, role, b.desig||ROLES[role].label, b.emp||"", b.contact||"", b.email||"", JSON.stringify(overrides)]
  );
  await writeAudit(req.user, "Edit user", b.name||cur.name, reqMeta(req));
  if(role !== cur.role) await writeAudit(req.user, "Role assignment", (b.name||cur.name)+" → "+ROLES[role].label, reqMeta(req));
  if(JSON.stringify(overrides) !== JSON.stringify(cur.perm_overrides)) await writeAudit(req.user, "Permission changes", "Overrides updated for "+(b.name||cur.name), reqMeta(req));
  broadcastUsers();
  const u = (await db.query("SELECT * FROM users WHERE id=$1",[cur.id])).rows[0];
  res.json(mapUser(u));
});

router.post("/users/:id/reset-password", requireAuth, requireAdmin, async (req,res) => {
  const cfg = await getConfig();
  const minLen = (cfg.settings && cfg.settings.pwMinLen) || 8;
  const pw = (req.body && req.body.password) || "temp1234";
  if(pw.length < minLen || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return res.status(400).json({ error:"Too weak (min "+minLen+", letter + digit)" });
  const cur = (await db.query("SELECT * FROM users WHERE id=$1",[req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"User not found" });
  const hash = await hashPw(pw);
  await db.query("UPDATE users SET pw_hash=$2, must_change=true, session_epoch=$3 WHERE id=$1", [cur.id, hash, Date.now()]);
  await writeAudit(req.user, "Password reset", cur.name+" (forced change on next login)", reqMeta(req));
  broadcastUsers();
  res.json({ ok:true });
});

router.post("/users/:id/lifecycle", requireAuth, requireAdmin, async (req,res) => {
  const st = (req.body && req.body.status) || "";
  const cur = (await db.query("SELECT * FROM users WHERE id=$1",[req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"User not found" });
  if(cur.role === "admin" && (st === "deactivated" || st === "archived" || st === "locked"))
    return res.status(400).json({ error:"Administrator account cannot be disabled" });
  const map = { active:"Account activation", locked:"Account lock", deactivated:"Account deactivation", archived:"Account archive", terminate:"Session terminated" };
  if(st === "terminate"){
    await db.query("UPDATE users SET session_epoch=$2 WHERE id=$1", [cur.id, Date.now()]);
  } else if(map[st]){
    const epoch = st === "active" ? cur.session_epoch : Date.now();
    await db.query("UPDATE users SET status=$2, session_epoch=$3, failed=CASE WHEN $2='active' THEN 0 ELSE failed END WHERE id=$1", [cur.id, st, epoch]);
  } else return res.status(400).json({ error:"Invalid status" });
  await writeAudit(req.user, map[st]||"Status change", cur.name, reqMeta(req));
  broadcastUsers();
  res.json({ ok:true });
});

router.delete("/users/:id", requireAuth, requireAdmin, async (req,res) => {
  const cur = (await db.query("SELECT * FROM users WHERE id=$1",[req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"User not found" });
  if(cur.id === req.user.id) return res.status(400).json({ error:"You cannot delete your own account." });
  if(cur.role === "admin"){
    const admins = (await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role='admin'")).rows[0].n;
    if(admins <= 1) return res.status(400).json({ error:"Cannot delete the only administrator account." });
  }
  await db.query("DELETE FROM users WHERE id=$1", [cur.id]);
  await writeAudit(req.user, "Account deletion", cur.name+" ("+(ROLES[cur.role]?ROLES[cur.role].label:cur.role)+")", reqMeta(req));
  broadcastUsers();
  res.json({ ok:true, id:cur.id });
});

// ---- Config & permission matrix ----
router.put("/config/settings", requireAuth, requireAdmin, async (req,res) => {
  const cfg = await getConfig();
  const s = { ...cfg.settings, ...(req.body||{}) };
  s.capacity = Math.max(1, parseInt(s.capacity)||cfg.settings.capacity);
  s.inactivityMin = Math.max(1, parseInt(s.inactivityMin)||120);
  s.pwMinLen = Math.max(6, parseInt(s.pwMinLen)||8);
  await setConfigKey("settings", s);
  await writeAudit(req.user, "System configuration", "Ward/security settings updated", reqMeta(req));
  broadcastConfig({ settings:s, matrix:cfg.matrix });
  res.json(s);
});

router.put("/config/matrix", requireAuth, requireAdmin, async (req,res) => {
  const body = req.body || {};
  const matrix = body.reset ? buildDefaultMatrix() : body.matrix;
  if(!matrix || typeof matrix !== "object") return res.status(400).json({ error:"Invalid matrix" });
  await setConfigKey("matrix", matrix);
  await writeAudit(req.user, "Permission changes", body.reset ? "Matrix reset to defaults" : (body.note||"Matrix updated"), reqMeta(req));
  const cfg = await getConfig();
  broadcastConfig({ settings:cfg.settings, matrix });
  res.json(matrix);
});

// ---- Audit log (immutable, searchable) ----
router.get("/audit", requireAuth, requireAudit, async (req,res) => {
  const q = (req.query.q || "").toString().toLowerCase();
  const r = await db.query("SELECT * FROM audit ORDER BY at DESC LIMIT 500");
  let rows = r.rows;
  if(q) rows = rows.filter(a => [a.uname,a.action,a.detail,a.role].join(" ").toLowerCase().includes(q));
  res.json(rows);
});

module.exports = { router };

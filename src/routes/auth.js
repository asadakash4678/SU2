"use strict";
const express = require("express");
const db = require("../../db");
const { hashPw, verifyPw, signToken, requireAuth } = require("../auth");
const { writeAudit, getConfig, rid } = require("../store");
const { broadcast, broadcastUsers } = require("../realtime");
const { ROLES } = require("../rbac");

const router = express.Router();
const PRIVILEGED = ["admin","hod","consultant","assocprof","asstprof","sr"];

function reqMeta(req){
  return {
    device: shortDevice(req.headers["user-agent"] || ""),
    ip: (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim()
  };
}
function shortDevice(ua){
  const os=/Windows/.test(ua)?"Windows":/Mac/.test(ua)?"macOS":/Android/.test(ua)?"Android":/iPhone|iPad/.test(ua)?"iOS":/Linux/.test(ua)?"Linux":"Unknown";
  const br=/Edg/.test(ua)?"Edge":/Chrome/.test(ua)?"Chrome":/Firefox/.test(ua)?"Firefox":/Safari/.test(ua)?"Safari":"Browser";
  return br+" · "+os;
}
function mapUser(u){
  return { id:u.id, username:u.username, name:u.name, role:u.role, desig:u.desig, emp:u.emp,
    contact:u.contact, email:u.email, status:u.status, mustChange:u.must_change,
    permOverrides:u.perm_overrides||{}, sessionEpoch:Number(u.session_epoch||0), failed:u.failed,
    lastLogin:u.last_login, created:u.created_at, createdBy:u.created_by };
}

// POST /api/auth/login
router.post("/login", async (req,res) => {
  const { username, password } = req.body || {};
  if(!username || !password) return res.status(400).json({ error:"Username and password required" });
  const meta = reqMeta(req);
  const r = await db.query("SELECT * FROM users WHERE username=$1", [String(username).toLowerCase()]);
  const user = r.rows[0];
  if(!user) return res.status(401).json({ error:"No account with that username" });
  if(user.status === "locked") return res.status(403).json({ error:"This account is locked. Contact an administrator." });
  if(user.status !== "active") return res.status(403).json({ error:"This account is "+user.status+". Contact an administrator." });

  const ok = await verifyPw(password, user.pw_hash);
  if(!ok){
    const failed = (user.failed||0) + 1;
    await writeAudit({ id:user.id, name:user.name, role:user.role }, "Failed login", "Attempt "+failed, meta);
    // §4.11 privileged-account alert
    if(PRIVILEGED.includes(user.role) && failed >= 3){
      const note = { id:rid(), at:new Date().toISOString(), text:"Security: "+failed+" failed login attempts on privileged account \u201C"+user.username+"\u201D", patientId:null, kind:"critical", read:false, by:"system" };
      await db.query("INSERT INTO records(id,collection,data,version,updated_by) VALUES($1,'notifications',$2,1,'system')", [note.id, JSON.stringify(note)]);
      broadcast("notifications","upsert",{ record:note });
    }
    if(failed >= 5){
      await db.query("UPDATE users SET status='locked', failed=$2 WHERE id=$1", [user.id, failed]);
      await writeAudit({ id:user.id, name:user.name, role:user.role }, "Account lock", "Auto-locked (failed logins)", meta);
      broadcastUsers();
      return res.status(403).json({ error:"Account locked after repeated failed attempts." });
    }
    await db.query("UPDATE users SET failed=$2 WHERE id=$1", [user.id, failed]);
    return res.status(401).json({ error:"Incorrect password"+(failed>=3?" ("+(5-failed)+" attempts left)":"") });
  }

  await db.query("UPDATE users SET failed=0, last_login=now() WHERE id=$1", [user.id]);
  const fresh = (await db.query("SELECT * FROM users WHERE id=$1",[user.id])).rows[0];
  const token = signToken(fresh);
  await writeAudit({ id:user.id, name:user.name, role:user.role }, "Login", "Signed in", meta);
  res.json({ token, user: mapUser(fresh) });
});

// POST /api/auth/change-password   (authenticated)
router.post("/change-password", requireAuth, async (req,res) => {
  const { current, next } = req.body || {};
  const cfg = await getConfig();
  const minLen = (cfg.settings && cfg.settings.pwMinLen) || 8;
  const u = req.user;
  if(!req.user.must_change){
    if(!current || !(await verifyPw(current, u.pw_hash))) return res.status(400).json({ error:"Current password is incorrect" });
  }
  if(!next || next.length < minLen || !/[a-zA-Z]/.test(next) || !/\d/.test(next))
    return res.status(400).json({ error:"Password must be at least "+minLen+" characters with a letter and a digit" });
  const hash = await hashPw(next);
  const epoch = Date.now();
  await db.query("UPDATE users SET pw_hash=$2, must_change=false, session_epoch=$3 WHERE id=$1", [u.id, hash, epoch]);
  const fresh = (await db.query("SELECT * FROM users WHERE id=$1",[u.id])).rows[0];
  await writeAudit(u, "Password change", "", reqMeta(req));
  res.json({ token: signToken(fresh), user: mapUser(fresh) });
});

// PUT /api/auth/contact — user updates their own contact info (§4.12)
router.put("/contact", requireAuth, async (req,res) => {
  const b = req.body || {};
  await db.query("UPDATE users SET contact=$2, email=$3 WHERE id=$1", [req.user.id, b.contact||"", b.email||""]);
  const fresh = (await db.query("SELECT * FROM users WHERE id=$1",[req.user.id])).rows[0];
  await writeAudit(req.user, "Update profile", "Contact info", reqMeta(req));
  res.json(mapUser(fresh));
});

// POST /api/auth/verify-password — confirm the current user's password before a sensitive action
router.post("/verify-password", requireAuth, async (req,res) => {
  const pw = (req.body && req.body.password) || "";
  const u = (await db.query("SELECT pw_hash FROM users WHERE id=$1",[req.user.id])).rows[0];
  const ok = u && await verifyPw(pw, u.pw_hash);
  if(!ok){ await writeAudit(req.user, "Password confirmation failed", "", reqMeta(req)); return res.status(401).json({ ok:false, error:"Incorrect password" }); }
  res.json({ ok:true });
});

module.exports = { router, mapUser, reqMeta };

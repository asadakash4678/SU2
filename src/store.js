"use strict";
const db = require("../db");
const { buildDefaultMatrix } = require("./rbac");
const { broadcastAudit } = require("./realtime");

const DEFAULT_CONFIG = {
  ward:"Surgical Unit-II", hospital:"Allied Hospital, Faisalabad",
  capacity:68, inactivityMin:120, pwMinLen:8
};

async function getConfig(){
  const r = await db.query("SELECT key,value FROM config");
  const out = {};
  r.rows.forEach(row => { out[row.key] = row.value; });
  if(!out.settings) out.settings = DEFAULT_CONFIG;
  if(!out.matrix)   out.matrix   = buildDefaultMatrix();
  return out;
}
async function setConfigKey(key, value){
  await db.query(
    `INSERT INTO config(key,value) VALUES($1,$2)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}
async function getMatrix(){ return (await getConfig()).matrix; }

async function writeAudit(user, action, detail, meta){
  meta = meta || {};
  const entry = {
    id: rid(), at: new Date().toISOString(),
    uid: user ? user.id : null, uname: user ? user.name : "system",
    role: user ? user.role : null, action, detail: detail || "",
    device: meta.device || "", ip: meta.ip || ""
  };
  await db.query(
    `INSERT INTO audit(id,at,uid,uname,role,action,detail,device,ip)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [entry.id, entry.at, entry.uid, entry.uname, entry.role, entry.action, entry.detail, entry.device, entry.ip]
  );
  broadcastAudit(entry);
  return entry;
}

function rid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,10); }

module.exports = { DEFAULT_CONFIG, getConfig, setConfigKey, getMatrix, writeAudit, rid };

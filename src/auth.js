"use strict";
/* Authentication & session security (§4.8–4.11).
   - Passwords hashed with bcrypt (industry-standard, salted).
   - Sessions are stateless JWTs carrying uid + role + epoch.
   - session_epoch invalidates all of a user's tokens after a password
     reset or admin session-termination. */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

function secret(){ return process.env.JWT_SECRET || "dev-insecure-secret"; }

async function hashPw(pw){ return bcrypt.hash(pw, 10); }
async function verifyPw(pw, hash){ return bcrypt.compare(pw, hash); }

function signToken(user){
  return jwt.sign(
    { uid:user.id, role:user.role, epoch:user.session_epoch||0 },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES || "12h" }
  );
}

async function loadUser(uid){
  const r = await db.query("SELECT * FROM users WHERE id=$1", [uid]);
  return r.rows[0] || null;
}

// Verify a JWT and load the fresh user, enforcing status + epoch.
async function authenticate(token){
  if(!token) throw httpErr(401,"No token");
  let payload;
  try { payload = jwt.verify(token, secret()); }
  catch(e){ throw httpErr(401,"Invalid or expired session"); }
  const user = await loadUser(payload.uid);
  if(!user) throw httpErr(401,"Account not found");
  if(user.status !== "active") throw httpErr(403,"Account "+user.status);
  if((user.session_epoch||0) !== (payload.epoch||0)) throw httpErr(401,"Session no longer valid");
  return user;
}

function httpErr(status,msg){ const e=new Error(msg); e.status=status; return e; }

// Express middleware
async function requireAuth(req,res,next){
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    req.user = await authenticate(token);
    next();
  } catch(e){ res.status(e.status||401).json({ error: e.message }); }
}

module.exports = { hashPw, verifyPw, signToken, authenticate, requireAuth, loadUser, httpErr };

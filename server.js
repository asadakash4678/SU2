"use strict";
require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const db = require("./db");
const { initRealtime } = require("./src/realtime");
const authRoutes = require("./src/routes/auth").router;
const recordRoutes = require("./src/routes/records").router;
const adminRoutes = require("./src/routes/admin").router;

async function createApp(){
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));   // CSP disabled for the self-contained inline SPA
  app.use(cors({ origin: (process.env.CORS_ORIGIN || "*").split(","), credentials:true }));
  app.use(express.json({ limit: "12mb" }));            // allows base64 clinical photos

  // Rate-limit auth endpoints against brute force
  app.use("/api/auth/login", rateLimit({ windowMs: 15*60*1000, max: 40, standardHeaders:true, legacyHeaders:false }));
  app.use("/api", rateLimit({ windowMs: 60*1000, max: 600, standardHeaders:true, legacyHeaders:false }));

  app.get("/api/health", async (req,res) => {
    try { await db.query("SELECT 1"); res.json({ ok:true, time:new Date().toISOString() }); }
    catch(e){ res.status(500).json({ ok:false, error:"database unavailable" }); }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api", recordRoutes);
  app.use("/api/admin", adminRoutes);

  // Serve the SPA
  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (req,res) => {
    if(req.path.startsWith("/api")) return res.status(404).json({ error:"Not found" });
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // JSON error handler
  app.use((err,req,res,next) => {
    console.error(err);
    res.status(err.status||500).json({ error: err.message || "Server error" });
  });
  return app;
}

async function start(){
  await db.initSchema();
  const { seed } = require("./db/seed");
  await seed();                                 // idempotent — only seeds an empty DB
  const app = await createApp();
  const server = http.createServer(app);
  initRealtime(server);
  const port = process.env.PORT || 4000;
  server.listen(port, () => console.log("SUMS server listening on http://localhost:"+port));
}

if(require.main === module){ start().catch(e => { console.error("Fatal:", e); process.exit(1); }); }

module.exports = { createApp, start };

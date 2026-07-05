"use strict";
require("dotenv").config();
const db = require("./index");
db.initSchema()
  .then(() => { console.log("Schema initialised."); process.exit(0); })
  .catch(e => { console.error("Schema init failed:", e); process.exit(1); });

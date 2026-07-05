"use strict";
/* Database access layer.
   Uses a real PostgreSQL pool in production. For automated tests, an
   in-memory pg-mem pool can be injected via setPool() so the exact same
   SQL runs without a live database. */
const fs = require("fs");
const path = require("path");

let pool = null;

function setPool(p) { pool = p; }

function getPool() {
  if (pool) return pool;
  const { Pool } = require("pg");
  const ssl = String(process.env.DATABASE_SSL).toLowerCase() === "true"
    ? { rejectUnauthorized: false } : false;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: 10,
    idleTimeoutMillis: 30000
  });
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await getPool().query(sql);
}

module.exports = { getPool, setPool, query, initSchema };

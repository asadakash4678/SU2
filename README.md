# SUMS — Surgical Unit-II Management System

A secure, **real-time, multi-user** web application for managing ward patient information from any device with an internet connection. Authorised users can view, add, edit, and manage patients; every change is saved to a central **PostgreSQL** database and pushed **instantly** to all connected users over WebSockets — no manual refresh.

- **Backend:** Node.js + Express + Socket.IO + PostgreSQL
- **Auth:** JWT sessions, bcrypt password hashing, role-based access control (spec §4)
- **Real-time:** every create / edit / delete is broadcast live to all users
- **Conflict handling:** optimistic concurrency (per-record versions); simultaneous edits are detected and reconciled
- **Frontend:** responsive single-page app (desktop / tablet / phone), served by the same server

---

## 1. What you need

- **Node.js 18+** (20 LTS recommended) — https://nodejs.org
- **A PostgreSQL database** (v14+). Either:
  - the bundled `docker-compose` (easiest for local / on-prem), or
  - a managed cloud database (Neon, Supabase, Amazon RDS, Render, Railway, Azure, GCP…).

---

## 2. Fastest start — one command (Docker)

If you have Docker Desktop installed, from the project folder:

```bash
docker compose up --build
```

This starts PostgreSQL **and** the app together, initialises the schema, and seeds demo data. Then open:

```
http://localhost:4000
```

Sign in with **`admin` / `admin123`** (change this immediately — see §7).

To stop: `Ctrl-C`, then `docker compose down`. Data persists in a Docker volume (`sums_pgdata`). Add `-v` to wipe it.

---

## 3. Manual setup (no Docker)

**a. Provision a PostgreSQL database** and get its connection string, e.g.
`postgres://user:password@host:5432/dbname`

**b. Configure the app**

```bash
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | What to set |
|---|---|
| `DATABASE_URL` | your PostgreSQL connection string |
| `DATABASE_SSL` | `true` for most managed clouds, `false` for local |
| `JWT_SECRET` | a long random string (see below) |
| `CORS_ORIGIN` | `*` for local; your real domain(s) in production |
| `SEED_DEMO` | `true` to load demo users + sample patients, `false` for a clean DB |

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**c. Install, initialise, run**

```bash
npm install
npm run init-db     # creates tables (safe to re-run)
npm run seed        # optional: demo users + sample data (respects SEED_DEMO)
npm start
```

Open `http://localhost:4000`.

> `npm start` also auto-creates the schema and seeds an empty database on first boot, so `init-db`/`seed` are optional conveniences.

---

## 4. Demo accounts (when `SEED_DEMO=true`)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | System Administrator |
| `hod` | `demo123` | Head of Department |
| `consultant` | `demo123` | Consultant |
| `assocprof` | `demo123` | Associate Professor |
| `registrar` | `demo123` | Senior Registrar |
| `resident` | `demo123` | Resident |
| `mo` | `demo123` | Medical Officer |
| `houseofficer` | `demo123` | House Officer |
| `nurse` | `demo123` | Nursing Staff |
| `dataentry` | `demo123` | Data Entry Operator |
| `readonly` | `demo123` | Read-Only User |

**Delete or disable all demo accounts before going live**, and set `SEED_DEMO=false` for a production database.

---

## 5. Try the real-time sync

Open the app in two browsers (or a laptop and a phone) and sign in as two different users. Admit or edit a patient in one — it appears **instantly** in the other. The topbar shows a live "N online" indicator. If two people edit the same record at once, the second save is detected and automatically refreshed to the latest version (with a notice), so nothing is silently overwritten.

---

## 6. Deploying to the internet

The app is a single Node service that serves both the API and the web app. Any host that runs Node + provides (or connects to) PostgreSQL works.

**Common managed options:**

- **Render / Railway / Fly.io:** create a "Web Service" from this repo, add a PostgreSQL instance, and set the environment variables from §3b. Render/Railway inject `DATABASE_URL` automatically; set `DATABASE_SSL=true`, a strong `JWT_SECRET`, and `CORS_ORIGIN` to your app's URL.
- **Neon / Supabase (database only) + any Node host:** use their connection string as `DATABASE_URL` (`DATABASE_SSL=true`).
- **Your own VPS:** install Node + PostgreSQL (or point at a managed DB), run behind **nginx** or **Caddy** as a reverse proxy with **HTTPS**, and keep the process alive with **pm2** or a systemd service.

**Always in production:**

- Serve over **HTTPS/TLS** (a browser will refuse secure cookies/features otherwise, and patient data must be encrypted in transit). A reverse proxy (nginx/Caddy) or the platform's built-in TLS handles this. WebSockets upgrade over the same HTTPS origin automatically.
- Set `CORS_ORIGIN` to your exact domain(s), not `*`.
- Set a unique, long `JWT_SECRET` (rotating it logs everyone out).
- Set `SEED_DEMO=false`.

---

## 7. First-run hardening checklist

1. Sign in as `admin`, open **Administration → Users**, and change the admin password (or create a new admin and remove the default).
2. Set `SEED_DEMO=false` and remove demo users/patients.
3. Confirm the app is only reachable over **HTTPS**.
4. Review the **permission matrix** (Administration) against your unit's policy.
5. Set up **database backups** (§8).

---

## 8. Backups & persistence

All data lives in PostgreSQL, so backup = database backup.

- **Managed clouds** (Neon, Supabase, RDS, Render): enable automated daily backups / point-in-time recovery in their dashboard. This is the recommended path.
- **Self-hosted:** schedule `pg_dump`:

  ```bash
  pg_dump "$DATABASE_URL" | gzip > sums-$(date +%F).sql.gz
  ```

  Restore with `gunzip -c file.sql.gz | psql "$DATABASE_URL"`.
- Store backups encrypted and off-site. Test a restore periodically.

The Docker volume `sums_pgdata` persists data across restarts; for real durability use managed backups or scheduled `pg_dump`, not just the volume.

---

## 9. Scaling

- A single instance comfortably serves a ward. To run **multiple app instances** behind a load balancer, add the Socket.IO Redis adapter so real-time events fan out across instances (`@socket.io/redis-adapter`) and enable sticky sessions on the load balancer. This is a small, well-documented addition when you need it.
- PostgreSQL scales vertically for this workload for a long way; use connection pooling (already configured) and a managed DB for HA.

---

## 10. Testing

```bash
npm test
```

Runs two suites against an **in-memory Postgres** (no database needed):

- `test/run.js` — 21 checks: auth, RBAC allow/deny per role, version-conflict (409), bootstrap scoping, admin user lifecycle, matrix editing, per-user overrides, forced password change + session invalidation, audit access control.
- `test/realtime.js` — 8 checks: two real WebSocket clients; live propagation of creates/edits/deletes across users, presence, conflict rejection, and admin config broadcast.

---

## 11. How it works (architecture)

- **`records` table (JSONB).** Clinical items (patients, notes, surgeries, meds, MAR, labs, I/O, drains, orders, tasks, chat, photos, timeline, notifications) are stored as documents with a `version` column. One generic, well-tested API path serves every module. The browser keeps an in-memory cache hydrated from `GET /api/bootstrap`.
- **Writes.** Create → `POST /api/records/:collection`; edit → `PUT …/:id` with the version the client last saw; delete → `DELETE …/:id`. A stale version returns **409** with the current server copy, and the client reloads it.
- **Real-time.** Every successful write broadcasts a `change` event over Socket.IO to all connected clients, which update their cache and re-render (debounced, and deferred while you're typing or a dialog is open, so it never disrupts you mid-edit).
- **Security.** Passwords are bcrypt-hashed and never leave the server. Sessions are JWTs that carry a `session_epoch`, so a password reset or admin "terminate sessions" instantly invalidates old tokens. **Every** mutating endpoint re-checks permissions server-side — the browser UI gating is convenience, not the security boundary. Auth endpoints are rate-limited; `helmet` sets secure headers. All actions are written to an append-only **audit** table.

Key files: `server.js` (entry), `db/schema.sql`, `src/rbac.js` (permission matrix), `src/auth.js`, `src/realtime.js`, `src/routes/*`, `public/` (the web app).

---

## 13. Deleting records & the discharge workflow

**Deleting a patient.** Users whose role grants the *Delete Patients* permission — by default Administrator, HOD, Consultant, Associate/Assistant Professor, Senior Registrar, and Resident — see a red **Delete** button on the patient profile. Deletion requires the user to **re-enter their own password** (verified on the server) and removes the patient together with all associated clinical records. Every deletion is written to the audit log.

**Deleting a user.** Administrators see a **Delete** button on each account in Administration → Users. Deletion asks for confirmation and is audited. You cannot delete your own account or the last remaining administrator.

**Discharge, LAMA/DOR, and death.** On an admitted patient, **Discharge** offers three outcomes:
- **Routine discharge** — generates a structured discharge summary auto-populated from the patient's diagnoses, operations, hospital course, investigations, and medications (all editable), with a **structured discharge-medication prescriber** (add multiple medicines, each with dose, frequency, duration, optional route, and instructions), follow-up plan, patient instructions, pending-investigation follow-up, and **consultant approval** (required unless a policy override with a recorded reason is used). Discharge date is validated against the admission date.
- **LAMA / Discharge on request** — records the requester's name, CNIC, relationship, witness, and the date/time of the request.
- **Record death** — records date/time of death, primary/secondary/tertiary causes, autopsy recommendation, body-handover details, the receiving attendant, and the declaring doctor with PMDC number. Because this is irreversible, the user must **re-enter their password** before it saves.

Each outcome archives the patient automatically and writes timeline and audit entries.

**Professional printable documents.** The **Discharge record** button opens an on-screen record with a **Print / Save PDF** action that produces a clean, A4-optimised hospital-style document — a **Discharge Slip**, **LAMA/DOR Certificate**, or **Death Record** as appropriate — each with the full clinical detail, signature lines (House Officer, Resident/Registrar, and Patient/Attendant + Witness for LAMA), and a hospital-stamp area. Use the browser's "Save as PDF" in the print dialog to export.

**Active vs archived records.** The Patients screen has an **Active / Archived** toggle. The Archived view is split into three sections — **Discharged**, **LAMA/DOR**, and **Deceased** — each sorted newest-first, with a search box (name, MRN, date) and a discharge-date range filter.

**Cancel a discharge or LAMA.** Authorised users (anyone with the Approve-Discharge permission, plus admins) can reverse an accidental discharge or LAMA from the archived patient's profile: it restores the patient to the active ward with all admission data intact and records the reason in the audit log. This is not available for deceased patients.

**Dialogs** close automatically after a successful action, show a brief confirmation, and refresh the screen so the latest data is visible.

---

## 14. ⚠️ Compliance & clinical-safety notice

This system stores **real patient health information**. Software alone does not make a deployment lawful or safe. Before using it with real patients, you (the operator) are responsible for ensuring:

- **Legal basis & data residency.** Hosting patient data must comply with your jurisdiction's health-data and privacy law (e.g. HIPAA in the US; local regulations in Pakistan/your country). Confirm where the database physically resides and that it's an approved location.
- **Encryption at rest.** Enable database encryption at rest with your provider (managed clouds typically offer this; verify it's on).
- **Access governance.** Real accounts for real staff, least-privilege roles, prompt de-provisioning of leavers, and periodic review of the audit log.
- **Backups & disaster recovery**, tested restores, and a data-retention policy.
- **A security review / penetration test** and an incident/breach response plan.
- **Institutional sign-off** from your hospital IT, information-governance, and clinical-safety officers. Treat this as a prototype until it has passed that review.

This project is provided as engineering scaffolding to build on, not as a certified medical device or a guarantee of regulatory compliance.
#   S U 2  
 
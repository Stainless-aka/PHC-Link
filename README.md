# Theos Lafiya

Offline-first primary healthcare stock and referral coordination platform.

## Requirements

- Node.js 20+
- PostgreSQL 14+

## Local setup

1. Open the PHC-Link Supabase project: https://supabase.com/dashboard/project/vqiraxattugqfacnlzst.
2. In **Connect**, copy the **Session pooler** connection URI and replace the placeholders in `.env.example` after copying it to `.env`. Use your database password; never commit it.
3. Set a strong `SESSION_SECRET` (at least 32 characters).
4. Install dependencies: `npm install`.
5. Apply the schema using `psql "$DATABASE_URL" -f database/migrations/001_initial_schema.sql`. The same initial schema has already been applied to the hosted PHC-Link Supabase project.
6. Start the API: `npm run dev`.
7. Check `http://localhost:3000/api/health`.

The static PWA in `frontend/` is integrated with the API. Its local outbox stores pending patient, visit, referral and stock actions and sends them when connectivity returns. Patient records are PIN-protected; verified records are cached encrypted on the device for offline access.

## API endpoints in this foundation

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/facilities`
- `POST /api/facilities` (state/system administrator)
- `GET /api/inventory/items`
- `GET /api/inventory/balances?facilityId=...`
- `POST /api/inventory/movements`
- `GET /api/referrals?facilityId=...`
- `POST /api/referrals`
- `PATCH /api/referrals/:id/status`
- `GET /api/patients?facilityId=...`
- `GET /api/patients/search?q=...`
- `POST /api/patients/lookup` (Patient ID + PIN required)
- `POST /api/patients/:id/visits` (PIN required)
- `PATCH /api/patients/:id` (PIN required)
- `POST /api/alert` (shared web / LoRa gateway / SMS / USSD alert intake)
- `GET /api/alerts` (role-scoped PHC status map)

## Account roles and professional designations

Theos Lafiya separates account permissions from a staff member's professional qualification.

**Account roles** determine system access:
- \`system_admin\`: manages the entire Theos Lafiya network and user access.
- \`state_admin\`: state-level administration.
- \`lga_officer\`: LGA-level oversight.
- \`health_worker\`: works within an assigned healthcare facility.

**Professional designation** describes a health worker's qualification or position. Supported values include Doctor, Medical Officer, Nurse, Midwife, CHEW and CHO. A designation does not grant permissions by itself.

**Clinical response access** is a separate administrator-controlled capability for a designated health worker. It opens the emergency referral response desk while preserving access to the normal facility workspace. Clinician accounts have the response desk by role; legacy health-worker accounts can still receive it through the separate administrator-controlled permission.

## Alert gateway setup

Set `ALERT_INGEST_KEY` on the API service before connecting a LoRa gateway or SMS/USSD provider. Send it in the `x-alert-key` header. The shared endpoint accepts `code`, `phc_code`, `details`, and an optional `source` (`web`, `lora`, `sms`, `ussd`, or `api`).

## Important

This is an initial development foundation, not a production-ready clinical system. Do not enter real patient information. Before a live pilot, add automated tests, negative-stock safeguards, full audit logging, CSRF protection appropriate to the deployment, security review, backup/restore verification, data-protection controls and a validated clinical referral workflow.


## First-time administrator setup

1. Generate a private setup key locally with `openssl rand -hex 32`.
2. In Render, open the `phc-link-api` service → **Environment** and add `BOOTSTRAP_SECRET` with that generated value. Save changes and wait for the service to restart.
3. Open the Theos Lafiya website and select **Administration**.
4. Complete the first-time setup form with the same setup key, your administrator details, and the initial state and LGA.
5. Sign in with the administrator email and password you created. The setup endpoint becomes permanently unavailable after the first user is created.

Keep the setup key private. It is only needed for this one-time bootstrap; do not commit it to Git or place it in frontend source code.

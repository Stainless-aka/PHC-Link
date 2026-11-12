# PHC Link

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

The API runs separately from the current static prototype in `frontend/`. Frontend API integration and the genuine offline queue are the next implementation milestone.

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

## Account roles and professional designations

PHC Link separates account permissions from a staff member's professional qualification.

**Account roles** determine system access:
- \`system_admin\`: manages the entire PHC Link network and user access.
- \`state_admin\`: state-level administration.
- \`lga_officer\`: LGA-level oversight.
- \`health_worker\`: works within an assigned healthcare facility.

**Professional designation** describes a health worker's qualification or position. Supported values include Doctor, Medical Officer, Nurse, Midwife, CHEW, CHO and Other. A designation does not grant permissions by itself.

**Clinical response access** is a separate administrator-controlled capability for a designated health worker. It opens the emergency referral response desk while preserving access to the normal facility workspace. Only enabled staff can acknowledge or reject emergency referrals through that desk.

## Important

This is an initial development foundation, not a production-ready clinical system. Do not enter real patient information. Before a live pilot, add automated tests, negative-stock safeguards, full audit logging, CSRF protection appropriate to the deployment, security review, backup/restore verification, data-protection controls and a validated clinical referral workflow.


## First-time administrator setup

1. Generate a private setup key locally with `openssl rand -hex 32`.
2. In Render, open the `phc-link-api` service → **Environment** and add `BOOTSTRAP_SECRET` with that generated value. Save changes and wait for the service to restart.
3. Open the PHC Link website and select **Administration**.
4. Complete the first-time setup form with the same setup key, your administrator details, and the initial state and LGA.
5. Sign in with the administrator email and password you created. The setup endpoint becomes permanently unavailable after the first user is created.

Keep the setup key private. It is only needed for this one-time bootstrap; do not commit it to Git or place it in frontend source code.

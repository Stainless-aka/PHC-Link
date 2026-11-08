# PHC Link

Offline-first primary healthcare stock and referral coordination platform.

## Requirements

- Node.js 20+
- PostgreSQL 14+

## Local setup

1. Create a PostgreSQL database named `phc_link`.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL` and a strong `SESSION_SECRET`.
3. Install dependencies: `npm install`.
4. Apply the initial schema using `psql "$DATABASE_URL" -f database/migrations/001_initial_schema.sql`.
5. Start the API: `npm run dev`.
6. Check `http://localhost:3000/api/health`.

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

## Important

This is an initial development foundation, not a production-ready clinical system. Do not enter real patient information. Before a live pilot, add automated tests, negative-stock safeguards, full audit logging, CSRF protection appropriate to the deployment, security review, backup/restore verification, data-protection controls and a validated clinical referral workflow.

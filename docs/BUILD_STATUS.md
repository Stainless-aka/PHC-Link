# PHC Link build status

## Starting point

The supplied `index.html` and `app.js` are preserved in `frontend/`. They are a client-side demonstration and still use in-memory demo data. The FCT facility data, network toggle, SMS/USSD simulator and schematic map are not production integrations.

## Implemented in this foundation slice

- Express API entry point with security headers, CORS, JSON size limit and rate-limited login.
- PostgreSQL connection pool.
- PostgreSQL-backed session store.
- Session login, current-user and logout endpoints.
- State, LGA, facility, user and facility-assignment schema.
- Inventory catalogue and stock movement ledger schema.
- Idempotent stock movement endpoint.
- Referral creation, referral history and status-transition endpoints.
- Facility/LGA-scoped access checks in API routes.
- Environment variable template and local run instructions.

## Not yet implemented / not production-ready

- Database migration runner and seed/admin bootstrap command.
- Frontend-to-API integration; current prototype still uses in-memory mock data.
- IndexedDB and service-worker offline queue.
- Full audit-log writes from all business operations.
- SMS/USSD provider integration.
- Automated tests and production security review.
- Clinical governance, consent workflow and data-protection impact assessment.

## Important data-model note

Stock movements are stored as signed ledger entries. The API supports positive and negative adjustments with a reason and direction. It checks the recorded balance before accepting a negative movement and serializes movements for the same facility/item pair with a transaction-scoped advisory lock. Concurrent transaction behavior still needs integration testing against PostgreSQL before production.

const express = require('express');
const bcrypt = require('bcryptjs');
const { timingSafeEqual } = require('crypto');
const pool = require('../config/db');

const router = express.Router();

router.get('/status', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT EXISTS (SELECT 1 FROM users) AS initialized');
    res.json({ initialized: result.rows[0].initialized, bootstrapConfigured: Boolean(process.env.BOOTSTRAP_SECRET) });
  } catch (error) { next(error); }
});

router.post('/bootstrap', async (req, res, next) => {
  const supplied = String(req.get('x-bootstrap-secret') || '');
  const expected = String(process.env.BOOTSTRAP_SECRET || '');
  if (!expected || supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Invalid setup key. Configure BOOTSTRAP_SECRET on the API service.' });
  }

  const { fullName, email, password, stateName, lgaName } = req.body;
  if (![fullName, email, password, stateName, lgaName].every(value => String(value || '').trim()) || password.length < 12) {
    return res.status(400).json({ error: 'Enter your name, email, a password of at least 12 characters, state and LGA.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('phc-link-initial-bootstrap'))");
    const existing = await client.query('SELECT 1 FROM users LIMIT 1');
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Initial setup has already been completed.' });
    }

    const state = await client.query(
      'INSERT INTO states (name) VALUES ($1) RETURNING id, name',
      [String(stateName).trim()]
    );
    const lga = await client.query(
      'INSERT INTO lgas (state_id, name) VALUES ($1, $2) RETURNING id, name',
      [state.rows[0].id, String(lgaName).trim()]
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, lower($2), $3, 'system_admin')
       RETURNING id, full_name, email, role`,
      [String(fullName).trim(), String(email).trim(), passwordHash]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'INITIAL_BOOTSTRAP', 'user', $1, $2)`,
      [user.rows[0].id, JSON.stringify({ stateId: state.rows[0].id, lgaId: lga.rows[0].id })]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Initial administrator created. Sign in to continue.', state: state.rows[0], lga: lga.rows[0], user: user.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'That state, LGA or email already exists.' });
    next(error);
  } finally { client.release(); }
});

module.exports = router;

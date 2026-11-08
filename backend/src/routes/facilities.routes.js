const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { role, id: userId } = req.session.user;
    const params = [];
    let where = '';
    if (role === 'health_worker' || role === 'clinician') {
      params.push(userId);
      where = `WHERE f.id IN (SELECT facility_id FROM facility_users WHERE user_id = $1 AND is_active = TRUE)`;
    } else if (role === 'lga_officer') {
      params.push(userId);
      where = `WHERE f.lga_id IN (SELECT lga_id FROM user_lga_access WHERE user_id = $1)`;
    }
    const result = await pool.query(
      `SELECT f.id, f.name, f.code, f.address, f.latitude, f.longitude,
              l.name AS lga_name, s.name AS state_name
       FROM facilities f JOIN lgas l ON l.id = f.lga_id
       JOIN states s ON s.id = l.state_id ${where}
       ORDER BY s.name, l.name, f.name`, params
    );
    res.json({ facilities: result.rows });
  } catch (error) { next(error); }
});

router.post('/', requireRole('state_admin', 'system_admin'), async (req, res, next) => {
  try {
    const { lgaId, name, code, address = null, latitude = null, longitude = null } = req.body;
    if (!lgaId || !String(name || '').trim() || !String(code || '').trim()) {
      return res.status(400).json({ error: 'LGA, facility name and facility code are required.' });
    }
    const result = await pool.query(
      `INSERT INTO facilities (lga_id, name, code, address, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, lga_id, name, code, address, latitude, longitude`,
      [lgaId, String(name).trim(), String(code).trim(), address, latitude, longitude]
    );
    res.status(201).json({ facility: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Facility code already exists.' });
    next(error);
  }
});

module.exports = router;

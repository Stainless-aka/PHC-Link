const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();

// Public, read-only facility directory for the login-page locator.
router.get('/directory', async (req, res, next) => {
 try {
  const [facilityResult,wardResult] = await Promise.all([
   pool.query(`SELECT f.id,f.name,f.code,f.address,COALESCE(w.name,f.ward_name) AS ward_name,f.source_ward_name,f.latitude,f.longitude,f.coordinates_are_approximate,f.location_verification_status,f.ward_mapping_status,f.directory_source,f.source_name,l.name AS lga_name,s.name AS state_name FROM facilities f JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id LEFT JOIN wards w ON w.id=f.ward_id WHERE COALESCE(f.is_active,TRUE)=TRUE ORDER BY s.name,l.name,COALESCE(w.name,f.ward_name),f.name`),
   pool.query(`SELECT w.id,w.name AS ward_name,w.code,l.name AS lga_name,s.name AS state_name FROM wards w JOIN lgas l ON l.id=w.lga_id JOIN states s ON s.id=l.state_id WHERE s.name='Yobe State' ORDER BY l.name,w.name`)
  ]);
  res.set('Cache-Control','public, max-age=300, stale-while-revalidate=600');
  const facilities=facilityResult.rows;
  const wards=wardResult.rows;
  const yobeFacilities=facilities.filter(f=>f.state_name==='Yobe State');
  const summary={yobeFacilities:yobeFacilities.length,wardMatched:yobeFacilities.filter(f=>f.ward_mapping_status==='matched').length,wardNeedsReview:yobeFacilities.filter(f=>f.ward_mapping_status==='needs_review').length,gpsVerified:yobeFacilities.filter(f=>f.location_verification_status==='verified'&&f.latitude!==null&&f.longitude!==null).length};
  res.json({facilities,wards,summary,wardReviewFacilities:yobeFacilities.filter(f=>f.ward_mapping_status==='needs_review')});
 } catch(error){next(error);}
});

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
      `SELECT f.id, f.name, f.code, f.address, f.latitude, f.longitude, f.coordinates_are_approximate,f.location_verification_status,f.ward_mapping_status,f.source_ward_name,
              l.name AS lga_name, s.name AS state_name
       FROM facilities f JOIN lgas l ON l.id = f.lga_id
       JOIN states s ON s.id = l.state_id ${where}
       ORDER BY s.name, l.name, f.name`, params
    );
    res.json({ facilities: result.rows });
  } catch (error) { next(error); }
});

router.get('/referral-destinations', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { originFacilityId } = req.query;
    if (!originFacilityId) return res.status(400).json({ error: 'originFacilityId is required.' });
    const user = req.session.user;
    let access;
    if (['system_admin', 'state_admin'].includes(user.role)) {
      access = await client.query('SELECT 1 FROM facilities WHERE id = $1 AND is_active = TRUE', [originFacilityId]);
    } else if (user.role === 'lga_officer') {
      access = await client.query(
        `SELECT 1 FROM facilities f JOIN user_lga_access a ON a.lga_id = f.lga_id
         WHERE f.id = $1 AND a.user_id = $2 AND f.is_active = TRUE`,
        [originFacilityId, user.id]
      );
    } else {
      access = await client.query(
        'SELECT 1 FROM facility_users WHERE facility_id = $1 AND user_id = $2 AND is_active = TRUE',
        [originFacilityId, user.id]
      );
    }
    if (!access.rowCount) return res.status(403).json({ error: 'You cannot create referrals from this facility.' });
    const result = await client.query(
      `SELECT f.id, f.name, l.name AS lga_name, s.name AS state_name
       FROM facilities f
       JOIN lgas l ON l.id = f.lga_id
       JOIN states s ON s.id = l.state_id
       WHERE f.id <> $1 AND f.is_active = TRUE
       ORDER BY s.name, l.name, f.name`,
      [originFacilityId]
    );
    res.json({ facilities: result.rows });
  } catch (error) { next(error); }
  finally { client.release(); }
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

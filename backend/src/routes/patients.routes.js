const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth, requireRole('health_worker', 'clinician'));

async function canAccessFacility(client, userId, facilityId) {
  const result = await client.query(
    `SELECT 1 FROM facility_users fu
     JOIN facilities f ON f.id = fu.facility_id
     WHERE fu.user_id = $1 AND fu.facility_id = $2
       AND fu.is_active = TRUE AND f.is_active = TRUE`,
    [userId, facilityId]
  );
  return result.rowCount > 0;
}

router.get('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const facilityId = String(req.query.facilityId || '');
    if (!facilityId) return res.status(400).json({ error: 'facilityId is required.' });
    if (!(await canAccessFacility(client, req.session.user.id, facilityId))) {
      return res.status(403).json({ error: 'You cannot access patients at this facility.' });
    }
    const result = await client.query(
      `SELECT id, patient_code, full_name, date_of_birth, sex, phone, created_at
       FROM patients WHERE facility_id = $1
       ORDER BY created_at DESC LIMIT 250`,
      [facilityId]
    );
    res.json({ patients: result.rows });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const facilityId = String(req.body.facilityId || '');
    const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
    const dateOfBirth = req.body.dateOfBirth ? String(req.body.dateOfBirth) : null;
    const sex = req.body.sex ? String(req.body.sex) : null;
    const phone = req.body.phone ? String(req.body.phone).trim() : null;
    const operationId = req.body.operationId ? String(req.body.operationId) : null;
    if (operationId && !/^[0-9a-f-]{36}$/i.test(operationId)) return res.status(400).json({ error: 'Invalid operation ID.' });
    if (!facilityId || fullName.length < 2 || fullName.length > 160) {
      return res.status(400).json({ error: 'Facility and a valid patient name are required.' });
    }
    if (dateOfBirth && (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth)) || new Date(dateOfBirth) > new Date())) {
      return res.status(400).json({ error: 'Enter a valid date of birth that is not in the future.' });
    }
    if (sex && !['female', 'male', 'unknown'].includes(sex)) {
      return res.status(400).json({ error: 'Select a valid sex value.' });
    }
    if (phone && phone.length > 30) return res.status(400).json({ error: 'Phone number is too long.' });

    await client.query('BEGIN');
    if (!(await canAccessFacility(client, req.session.user.id, facilityId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot register patients at this facility.' });
    }
    if (operationId) {
      const duplicate = await client.query('SELECT id,patient_code,full_name,date_of_birth,sex,phone,created_at FROM patients WHERE operation_id=$1', [operationId]);
      if (duplicate.rowCount) { await client.query('COMMIT'); return res.json({ duplicate:true, patient:duplicate.rows[0] }); }
    }
    const code = 'PT-' + randomUUID().slice(0, 8).toUpperCase();
    const created = await client.query(
      `INSERT INTO patients (facility_id, patient_code, full_name, date_of_birth, sex, phone, created_by, operation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, patient_code, full_name, date_of_birth, sex, phone, created_at`,
      [facilityId, code, fullName, dateOfBirth, sex, phone, req.session.user.id, operationId]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'PATIENT_REGISTERED', 'patient', $2, $3)`,
      [req.session.user.id, created.rows[0].id, JSON.stringify({ facilityId })]
    );
    await client.query('COMMIT');
    res.status(201).json({ patient: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});


router.patch('/:patientId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const patientId = String(req.params.patientId || '');
    const fullName = String(req.body.fullName || '').trim().replace(/\\s+/g, ' ');
    const dateOfBirth = req.body.dateOfBirth ? String(req.body.dateOfBirth) : null;
    const sex = req.body.sex ? String(req.body.sex) : null;
    const phone = req.body.phone ? String(req.body.phone).trim() : null;

    if (req.session.user.role !== 'health_worker') {
      return res.status(403).json({ error: 'Only health workers can edit patient details.' });
    }
    if (!patientId || fullName.length < 2 || fullName.length > 160) {
      return res.status(400).json({ error: 'Enter a valid patient name.' });
    }
    if (dateOfBirth && (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth)) || new Date(dateOfBirth) > new Date())) {
      return res.status(400).json({ error: 'Enter a valid date of birth that is not in the future.' });
    }
    if (sex && !['female', 'male', 'unknown'].includes(sex)) {
      return res.status(400).json({ error: 'Select a valid sex value.' });
    }
    if (phone && phone.length > 30) {
      return res.status(400).json({ error: 'Phone number is too long.' });
    }

    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id, facility_id FROM patients WHERE id = $1 FOR UPDATE',
      [patientId]
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Patient record not found.' });
    }
    if (!(await canAccessFacility(client, req.session.user.id, existing.rows[0].facility_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot edit patients at this facility.' });
    }

    const updated = await client.query(
      `UPDATE patients
       SET full_name = $1, date_of_birth = $2, sex = $3, phone = $4
       WHERE id = $5
       RETURNING id, patient_code, full_name, date_of_birth, sex, phone, created_at`,
      [fullName, dateOfBirth, sex, phone, patientId]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'PATIENT_UPDATED', 'patient', $2, $3)`,
      [req.session.user.id, patientId, JSON.stringify({ facilityId: existing.rows[0].facility_id, fields: ['full_name', 'date_of_birth', 'sex', 'phone'] })]
    );
    await client.query('COMMIT');
    res.json({ patient: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

module.exports = router;

const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth);

async function canAccessFacility(client, user, facilityId) {
  if (['system_admin', 'state_admin'].includes(user.role)) return true;
  if (user.role === 'lga_officer') {
    const result = await client.query(
      `SELECT 1 FROM facilities f JOIN user_lga_access a ON a.lga_id = f.lga_id
       WHERE f.id = $1 AND a.user_id = $2`, [facilityId, user.id]
    );
    return result.rowCount > 0;
  }
  const result = await client.query(
    `SELECT 1 FROM facility_users WHERE facility_id = $1 AND user_id = $2 AND is_active = TRUE`,
    [facilityId, user.id]
  );
  return result.rowCount > 0;
}

router.get('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const facilityId = req.query.facilityId;
    if (!facilityId) return res.status(400).json({ error: 'facilityId is required.' });
    if (!(await canAccessFacility(client, req.session.user, facilityId))) {
      return res.status(403).json({ error: 'You cannot access this facility.' });
    }
    const result = await client.query(
      `SELECT r.id, r.referral_code, r.origin_facility_id, r.destination_facility_id,
              r.patient_id, p.patient_code, p.full_name AS patient_name, r.reason_code, r.urgency,
              r.status, r.created_at, r.updated_at,
              latest_event.event_type AS latest_event_type, latest_event.notes AS clinician_reply,
              latest_event.created_at AS reply_at,
              src.name AS origin_facility, dst.name AS destination_facility
       FROM referrals r JOIN facilities src ON src.id = r.origin_facility_id
       JOIN facilities dst ON dst.id = r.destination_facility_id
       LEFT JOIN patients p ON p.id = r.patient_id
       LEFT JOIN LATERAL (
         SELECT event_type, notes, created_at FROM referral_events
         WHERE referral_id = r.id ORDER BY created_at DESC LIMIT 1
       ) latest_event ON TRUE
       WHERE r.origin_facility_id = $1 OR r.destination_facility_id = $1
       ORDER BY r.created_at DESC LIMIT 100`, [facilityId]
    );
    res.json({ referrals: result.rows });
  } catch (error) { next(error); }
  finally { client.release(); }
});


router.get('/clinician/inbox', async (req, res, next) => {
  if (req.session.user.role !== 'clinician') return res.status(403).json({ error: 'Clinician access required.' });
  try {
    const result = await pool.query(
      `SELECT r.id,r.referral_code,r.urgency,r.status,r.reason_code,r.created_at,r.updated_at,
              p.patient_code,p.full_name AS patient_name,p.sex,p.date_of_birth,
              src.name AS origin_facility,src.code AS origin_code,
              l.name AS origin_lga,s.name AS origin_state,
              latest_event.notes AS latest_reply
       FROM referrals r
       JOIN facilities src ON src.id=r.origin_facility_id
       JOIN lgas l ON l.id=src.lga_id
       JOIN states s ON s.id=l.state_id
       LEFT JOIN patients p ON p.id=r.patient_id
       LEFT JOIN LATERAL (
         SELECT notes FROM referral_events WHERE referral_id=r.id
         ORDER BY created_at DESC LIMIT 1
       ) latest_event ON TRUE
       WHERE r.urgency='emergency' AND r.status IN ('submitted','acknowledged')
       ORDER BY CASE WHEN r.status='submitted' THEN 0 ELSE 1 END, r.created_at ASC
       LIMIT 250`
    );
    res.json({ referrals: result.rows });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      operationId = randomUUID(), originFacilityId, destinationFacilityId,
      patientId, reasonCode, urgency = 'routine'
    } = req.body;
    if (!originFacilityId || !destinationFacilityId || !patientId || !reasonCode || !['routine', 'urgent', 'emergency'].includes(urgency)) {
      return res.status(400).json({ error: 'Origin, destination, patient, reason and valid urgency are required.' });
    }

    await client.query('BEGIN');
    if (!(await canAccessFacility(client, req.session.user, originFacilityId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot create referrals for this facility.' });
    }
    const duplicate = await client.query('SELECT id, referral_code FROM referrals WHERE operation_id = $1', [operationId]);
    if (duplicate.rowCount) {
      await client.query('ROLLBACK');
      return res.json({ duplicate: true, referral: duplicate.rows[0] });
    }
    if (originFacilityId === destinationFacilityId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose a different destination facility.' });
    }
    const destination = await client.query('SELECT id FROM facilities WHERE id = $1 AND is_active = TRUE', [destinationFacilityId]);
    if (!destination.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Destination facility not found.' });
    }
    const patient = await client.query('SELECT id FROM patients WHERE id = $1 AND facility_id = $2', [patientId, originFacilityId]);
    if (!patient.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Select a patient registered at your assigned facility.' });
    }
    const code = `PHC-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await client.query(
      `INSERT INTO referrals
       (referral_code, origin_facility_id, destination_facility_id, created_by,
        patient_id, reason_code, urgency, status, operation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8)
       RETURNING id, referral_code, origin_facility_id, destination_facility_id, patient_id, urgency, status, created_at`,
      [code, originFacilityId, destinationFacilityId, req.session.user.id, patientId, reasonCode, urgency, operationId]
    );
    await client.query(
      `INSERT INTO referral_events (referral_id, event_type, actor_user_id, notes)
       VALUES ($1, 'submitted', $2, 'Referral created')`,
      [created.rows[0].id, req.session.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ referral: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'Referral operation already exists.' });
    next(error);
  } finally { client.release(); }
});

router.patch('/:id/status', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { status, notes = null } = req.body;
    const transitions = {
      submitted: ['acknowledged', 'rejected', 'cancelled'],
      acknowledged: ['arrived', 'rejected', 'cancelled'],
      arrived: ['completed'],
      rejected: [], cancelled: [], completed: []
    };
    if (!Object.prototype.hasOwnProperty.call(transitions, status)) {
      return res.status(400).json({ error: 'Invalid referral status.' });
    }
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM referrals WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Referral not found.' });
    }
    const referral = current.rows[0];
    const user = req.session.user;
    const allowedFacility = ['acknowledged', 'arrived', 'completed', 'rejected'].includes(status)
      ? referral.destination_facility_id : referral.origin_facility_id;
    const clinicianEmergencyAction = user.role === 'clinician' && referral.urgency === 'emergency' && ['acknowledged','rejected'].includes(status);
    const canUpdate = clinicianEmergencyAction || await canAccessFacility(client, user, allowedFacility) || ['state_admin', 'system_admin'].includes(user.role);
    if (user.role === 'clinician' && !clinicianEmergencyAction && !await canAccessFacility(client, user, allowedFacility)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Clinicians can only respond to emergency referrals.' });
    }
    if (notes !== null && String(notes).length > 500) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Instructions must be 500 characters or fewer.' });
    }
    if (!canUpdate) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot update this referral.' });
    }
    if (!transitions[referral.status]?.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot move referral from ${referral.status} to ${status}.` });
    }
    const updated = await client.query(
      `UPDATE referrals SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, referral_code, status, updated_at`, [status, req.params.id]
    );
    await client.query(
      `INSERT INTO referral_events (referral_id, event_type, actor_user_id, notes)
       VALUES ($1,$2,$3,$4)`, [req.params.id, status, user.id, notes]
    );
    await client.query('COMMIT');
    res.json({ referral: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

module.exports = router;

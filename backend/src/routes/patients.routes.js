const express = require('express');
const { randomUUID, randomInt } = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth, requireRole('health_worker', 'clinician', 'lga_officer'));

async function canAccessFacility(client, user, facilityId) {
  if (['health_worker', 'clinician'].includes(user.role)) {
    const result = await client.query(
      `SELECT 1 FROM facility_users fu JOIN facilities f ON f.id=fu.facility_id
       WHERE fu.user_id=$1 AND fu.facility_id=$2 AND fu.is_active=TRUE AND f.is_active=TRUE`,
      [user.id, facilityId]
    );
    return result.rowCount > 0;
  }
  if (user.role === 'lga_officer') {
    const result = await client.query(
      `SELECT 1 FROM facilities f JOIN user_lga_access a ON a.lga_id=f.lga_id
       WHERE f.id=$1 AND a.user_id=$2 AND f.is_active=TRUE`,
      [facilityId, user.id]
    );
    return result.rowCount > 0;
  }
  return false;
}

async function canAccessPatientNetwork(client, user, patientId) {
  const patient = await client.query(
    `SELECT s.id AS state_id FROM patients p
     JOIN facilities f ON f.id=p.facility_id
     JOIN lgas l ON l.id=f.lga_id
     JOIN states s ON s.id=l.state_id
     WHERE p.id=$1`, [patientId]
  );
  if (!patient.rowCount) return false;
  if (['health_worker', 'clinician'].includes(user.role)) {
    const access = await client.query(
      `SELECT 1 FROM facility_users fu
       JOIN facilities f ON f.id=fu.facility_id
       JOIN lgas l ON l.id=f.lga_id
       WHERE fu.user_id=$1 AND fu.is_active=TRUE AND f.is_active=TRUE AND l.state_id=$2`,
      [user.id, patient.rows[0].state_id]
    );
    return access.rowCount > 0;
  }
  if (user.role === 'lga_officer') {
    const access = await client.query(
      `SELECT 1 FROM user_lga_access a JOIN lgas l ON l.id=a.lga_id
       WHERE a.user_id=$1 AND l.state_id=$2`,
      [user.id, patient.rows[0].state_id]
    );
    return access.rowCount > 0;
  }
  return false;
}

function validatePatient(body) {
  const fullName = String(body.fullName || '').trim().replace(/\\s+/g, ' ');
  const ageYears = body.ageYears === '' || body.ageYears === null || body.ageYears === undefined ? null : Number(body.ageYears);
  const sex = body.sex ? String(body.sex) : null;
  const phone = body.phone ? String(body.phone).trim() : null;
  const nextOfKinName = body.nextOfKinName ? String(body.nextOfKinName).trim() : null;
  const nextOfKinPhone = body.nextOfKinPhone ? String(body.nextOfKinPhone).trim() : null;
  const bloodGroup = body.bloodGroup ? String(body.bloodGroup) : null;
  const knownConditions = body.knownConditions ? String(body.knownConditions).trim() : null;
  const allergies = body.allergies ? String(body.allergies).trim() : null;
  if (fullName.length < 2 || fullName.length > 160) throw Object.assign(new Error('Enter a valid patient name.'), { status: 400 });
  if (ageYears !== null && (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > 120)) throw Object.assign(new Error('Age must be between 0 and 120.'), { status: 400 });
  if (sex && !['female', 'male', 'unknown'].includes(sex)) throw Object.assign(new Error('Select a valid sex.'), { status: 400 });
  if (phone && phone.length > 30) throw Object.assign(new Error('Phone number is too long.'), { status: 400 });
  if (nextOfKinName && nextOfKinName.length > 160) throw Object.assign(new Error('Next of kin name is too long.'), { status: 400 });
  if (nextOfKinPhone && nextOfKinPhone.length > 30) throw Object.assign(new Error('Next of kin phone is too long.'), { status: 400 });
  if (bloodGroup && !['A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'].includes(bloodGroup)) throw Object.assign(new Error('Select a valid blood group.'), { status: 400 });
  if ([knownConditions, allergies].some(value => value && value.length > 1000)) throw Object.assign(new Error('Medical notes must be 1,000 characters or fewer.'), { status: 400 });
  return { fullName, ageYears, sex, phone, nextOfKinName, nextOfKinPhone, bloodGroup, knownConditions, allergies };
}

async function verifyPatientPin(client, patientId, pin) {
  const found = await client.query(
    'SELECT id,pin_hash,pin_failed_attempts,pin_locked_until FROM patients WHERE id=$1 FOR UPDATE',
    [patientId]
  );
  if (!found.rowCount) return { error: 'Patient record not found.', status: 404 };
  const patient = found.rows[0];
  if (patient.pin_locked_until && new Date(patient.pin_locked_until) > new Date()) {
    return { error: 'Wrong PIN. Access is locked for 5 minutes.', status: 429 };
  }
  if (!patient.pin_hash) return { error: 'This older patient record needs a PIN set by its registered PHC.', status: 409 };
  if (!/^\\d{4}$/.test(String(pin || '')) || !(await bcrypt.compare(String(pin), patient.pin_hash))) {
    const attempts = patient.pin_locked_until ? 0 : Number(patient.pin_failed_attempts || 0);
    const nextAttempts = attempts + 1;
    if (nextAttempts >= 3) {
      await client.query('UPDATE patients SET pin_failed_attempts=3,pin_locked_until=NOW()+INTERVAL \'5 minutes\' WHERE id=$1', [patientId]);
      return { error: 'Wrong PIN. Access is locked for 5 minutes.', status: 429 };
    }
    await client.query('UPDATE patients SET pin_failed_attempts=$1 WHERE id=$2', [nextAttempts, patientId]);
    return { error: 'Wrong PIN.', status: 401 };
  }
  await client.query('UPDATE patients SET pin_failed_attempts=0,pin_locked_until=NULL WHERE id=$1', [patientId]);
  return { ok: true };
}

router.get('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const facilityId = String(req.query.facilityId || '');
    if (!facilityId) return res.status(400).json({ error: 'facilityId is required.' });
    if (!(await canAccessFacility(client, req.session.user, facilityId))) return res.status(403).json({ error: 'You cannot access patients at this facility.' });
    const result = await client.query(
      `SELECT id,patient_code,age_years,sex,created_at
       FROM patients WHERE facility_id=$1 ORDER BY created_at DESC LIMIT 250`,
      [facilityId]
    );
    res.json({ patients: result.rows });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.get('/search', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const query = String(req.query.q || '').trim();
    if (query.length < 2 || query.length > 160) return res.status(400).json({ error: 'Enter at least 2 characters to search.' });
    const result = await client.query(
      `SELECT p.id,p.patient_code,p.age_years,p.sex,f.name AS registered_facility
       FROM patients p JOIN facilities f ON f.id=p.facility_id
       WHERE p.patient_code ILIKE $1 OR p.full_name ILIKE $1 OR COALESCE(p.phone,'') ILIKE $1
       ORDER BY p.created_at DESC LIMIT 30`,
      ['%' + query + '%']
    );
    const allowed = [];
    for (const patient of result.rows) if (await canAccessPatientNetwork(client, req.session.user, patient.id)) allowed.push(patient);
    res.json({ patients: allowed });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.session.user.role === 'lga_officer') return res.status(403).json({ error: 'Only PHC workers and clinicians can register patients.' });
    const facilityId = String(req.body.facilityId || '');
    const details = validatePatient(req.body);
    const operationId = req.body.operationId ? String(req.body.operationId) : randomUUID();
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return res.status(400).json({ error: 'Invalid operation ID.' });
    await client.query('BEGIN');
    if (!(await canAccessFacility(client, req.session.user, facilityId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot register patients at this facility.' });
    }
    const duplicate = await client.query(
      'SELECT id,patient_code,age_years,sex,created_at FROM patients WHERE operation_id=$1',
      [operationId]
    );
    if (duplicate.rowCount) {
      await client.query('COMMIT');
      return res.json({ duplicate: true, patient: duplicate.rows[0] });
    }
    const facility = await client.query(
      `SELECT f.code,s.name AS state_name FROM facilities f
       JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id
       WHERE f.id=$1 AND f.is_active=TRUE FOR UPDATE OF f`,
      [facilityId]
    );
    if (!facility.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facility not found.' });
    }
    const count = await client.query('SELECT COUNT(*)::int AS total FROM patients WHERE facility_id=$1', [facilityId]);
    const stateCode = /yobe/i.test(facility.rows[0].state_name) ? 'YB' : facility.rows[0].state_name.split(/\\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase();
    const facilityCode = String(facility.rows[0].code).replace(/[^A-Za-z0-9-]/g,'').toUpperCase();
    const patientCode = stateCode + '-' + facilityCode + '-' + String(count.rows[0].total + 1).padStart(5,'0');
    const pin = String(randomInt(1000, 10000));
    const pinHash = await bcrypt.hash(pin, 12);
    const created = await client.query(
      `INSERT INTO patients
       (facility_id,patient_code,full_name,date_of_birth,age_years,sex,phone,created_by,operation_id,
        next_of_kin_name,next_of_kin_phone,blood_group,known_conditions,allergies,pin_hash)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id,patient_code,age_years,sex,created_at`,
      [facilityId,patientCode,details.fullName,details.ageYears,details.sex,details.phone,req.session.user.id,operationId,
       details.nextOfKinName,details.nextOfKinPhone,details.bloodGroup,details.knownConditions,details.allergies,pinHash]
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
       VALUES($1,'PATIENT_REGISTERED','patient',$2,$3)`,
      [req.session.user.id,created.rows[0].id,JSON.stringify({ facilityId, patientCode })]
    );
    await client.query('COMMIT');
    const qrCode = await QRCode.toDataURL(patientCode, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
    res.status(201).json({ patient: created.rows[0], patientPin: pin, qrCode });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'Patient ID already exists. Please retry registration.' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally { client.release(); }
});

router.post('/lookup', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const patientCode = String(req.body.patientCode || '').trim().toUpperCase();
    const pin = String(req.body.pin || '');
    if (!patientCode || !/^\\d{4}$/.test(pin)) return res.status(400).json({ error: 'Patient ID and 4-digit PIN are required.' });
    await client.query('BEGIN');
    const found = await client.query('SELECT id FROM patients WHERE patient_code=$1', [patientCode]);
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Patient record not found.' });
    }
    const patientId = found.rows[0].id;
    if (!(await canAccessPatientNetwork(client, req.session.user, patientId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You are not authorised to access this patient in your state network.' });
    }
    const verified = await verifyPatientPin(client, patientId, pin);
    if (!verified.ok) {
      await client.query('COMMIT');
      return res.status(verified.status).json({ error: verified.error });
    }
    const record = await client.query(
      `SELECT p.id,p.patient_code,p.full_name,p.age_years,p.sex,p.phone,p.next_of_kin_name,
              p.next_of_kin_phone,p.blood_group,p.known_conditions,p.allergies,p.created_at,
              f.name AS registered_facility,l.name AS registered_lga,s.name AS registered_state
       FROM patients p JOIN facilities f ON f.id=p.facility_id
       JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id WHERE p.id=$1`,
      [patientId]
    );
    const visits = await client.query(
      `SELECT v.id,v.complaint,v.treatment,v.referral_status,v.clinician_note,v.created_at,
              f.name AS facility_name,l.name AS lga_name
       FROM patient_visits v JOIN facilities f ON f.id=v.facility_id
       JOIN lgas l ON l.id=f.lga_id WHERE v.patient_id=$1 ORDER BY v.created_at DESC`,
      [patientId]
    );
    await client.query('COMMIT');
    res.json({ patient: record.rows[0], visits: visits.rows });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

router.post('/:patientId/initialize-pin', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.session.user.role !== 'health_worker') return res.status(403).json({ error: 'Only the registered PHC worker can initialize a patient PIN.' });
    await client.query('BEGIN');
    const existing = await client.query('SELECT id,facility_id,patient_code,pin_hash FROM patients WHERE id=$1 FOR UPDATE', [req.params.patientId]);
    if (!existing.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Patient record not found.' }); }
    if (!(await canAccessFacility(client, req.session.user, existing.rows[0].facility_id))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'You cannot initialize this patient record.' }); }
    if (existing.rows[0].pin_hash) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This patient already has a PIN.' }); }
    const pin = String(randomInt(1000,10000));
    const hash = await bcrypt.hash(pin,12);
    await client.query('UPDATE patients SET pin_hash=$1,pin_failed_attempts=0,pin_locked_until=NULL WHERE id=$2',[hash,req.params.patientId]);
    await client.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,\'PATIENT_PIN_INITIALIZED\',\'patient\',$2)',[req.session.user.id,req.params.patientId]);
    await client.query('COMMIT');
    const qrCode = await QRCode.toDataURL(existing.rows[0].patient_code,{errorCorrectionLevel:'M',margin:1,width:240});
    res.json({patient:{id:existing.rows[0].id,patient_code:existing.rows[0].patient_code},patientPin:pin,qrCode});
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally { client.release(); }
});

router.post('/:patientId/visits', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!['health_worker','clinician'].includes(req.session.user.role)) return res.status(403).json({ error: 'Only PHC workers and clinicians can add patient visits.' });
    const complaint = String(req.body.complaint || '').trim();
    const treatment = req.body.treatment ? String(req.body.treatment).trim() : null;
    const clinicianNote = req.body.clinicianNote ? String(req.body.clinicianNote).trim() : null;
    const referralStatus = String(req.body.referralStatus || 'not_referred');
    if (complaint.length < 2 || complaint.length > 1000 || (treatment && treatment.length > 2000) || (clinicianNote && clinicianNote.length > 2000)) return res.status(400).json({ error: 'Enter a valid complaint and keep notes within 2,000 characters.' });
    if (!['not_referred','referred','accepted','completed'].includes(referralStatus)) return res.status(400).json({ error: 'Select a valid referral status.' });
    if (clinicianNote && req.session.user.role !== 'clinician') return res.status(403).json({ error: 'Only a clinician can add a clinician note.' });
    await client.query('BEGIN');
    if (!(await canAccessPatientNetwork(client, req.session.user, req.params.patientId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot access this patient in your state network.' });
    }
    const verified = await verifyPatientPin(client, req.params.patientId, req.body.pin);
    if (!verified.ok) {
      await client.query('COMMIT');
      return res.status(verified.status).json({ error: verified.error });
    }
    const assignment = await client.query(
      `SELECT f.id FROM facility_users fu JOIN facilities f ON f.id=fu.facility_id
       WHERE fu.user_id=$1 AND fu.is_active=TRUE AND f.is_active=TRUE LIMIT 1`,
      [req.session.user.id]
    );
    if (!assignment.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Your account has no active facility assignment.' });
    }
    const created = await client.query(
      `INSERT INTO patient_visits(patient_id,facility_id,recorded_by,complaint,treatment,referral_status,clinician_note)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,complaint,treatment,referral_status,clinician_note,created_at`,
      [req.params.patientId,assignment.rows[0].id,req.session.user.id,complaint,treatment,referralStatus,clinicianNote]
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
       VALUES($1,'PATIENT_VISIT_ADDED','patient',$2,$3)`,
      [req.session.user.id,req.params.patientId,JSON.stringify({ visitId:created.rows[0].id, facilityId:assignment.rows[0].id })]
    );
    await client.query('COMMIT');
    res.status(201).json({ visit:created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

router.patch('/:patientId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.session.user.role !== 'health_worker') return res.status(403).json({ error: 'Only health workers can edit patient details.' });
    const patientId = String(req.params.patientId || '');
    const fullName = String(req.body.fullName || '').trim().replace(/\\s+/g, ' ');
    const dateOfBirth = req.body.dateOfBirth ? String(req.body.dateOfBirth) : null;
    const sex = req.body.sex ? String(req.body.sex) : null;
    const phone = req.body.phone ? String(req.body.phone).trim() : null;
    if (!patientId || fullName.length < 2 || fullName.length > 160) return res.status(400).json({ error: 'Enter a valid patient name.' });
    if (dateOfBirth && (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth)) || new Date(dateOfBirth) > new Date())) return res.status(400).json({ error: 'Enter a valid date of birth that is not in the future.' });
    if (sex && !['female','male','unknown'].includes(sex)) return res.status(400).json({ error: 'Select a valid sex value.' });
    if (phone && phone.length > 30) return res.status(400).json({ error: 'Phone number is too long.' });
    await client.query('BEGIN');
    const existing = await client.query('SELECT id,facility_id FROM patients WHERE id=$1 FOR UPDATE', [patientId]);
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Patient record not found.' });
    }
    if (!(await canAccessFacility(client, req.session.user, existing.rows[0].facility_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot edit patients at this facility.' });
    }
    const updated = await client.query(
      `UPDATE patients SET full_name=$1,date_of_birth=$2,sex=$3,phone=$4
       WHERE id=$5 RETURNING id,patient_code,age_years,sex,created_at`,
      [fullName,dateOfBirth,sex,phone,patientId]
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
       VALUES($1,'PATIENT_UPDATED','patient',$2,$3)`,
      [req.session.user.id,patientId,JSON.stringify({ facilityId:existing.rows[0].facility_id })]
    );
    await client.query('COMMIT');
    res.json({ patient: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

module.exports = router;

const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth, requireRole('health_worker', 'clinician', 'lga_officer'));

async function canAccessFacility(client, user, facilityId) {
  if (['system_admin', 'state_admin'].includes(user.role)) return true;
  if (user.role === 'lga_officer') {
    const r = await client.query('SELECT 1 FROM facilities f JOIN user_lga_access a ON a.lga_id=f.lga_id WHERE f.id=$1 AND a.user_id=$2', [facilityId, user.id]);
    return r.rowCount > 0;
  }
  const r = await client.query('SELECT 1 FROM facility_users WHERE facility_id=$1 AND user_id=$2 AND is_active=TRUE', [facilityId, user.id]);
  return r.rowCount > 0;
}
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value));
const opId = value => /^[0-9a-f-]{36}$/i.test(String(value || '')) ? String(value) : randomUUID();

router.get('/appointments', async (req, res, next) => {
  const c = await pool.connect();
  try {
    const facilityId = String(req.query.facilityId || '');
    if (!facilityId || !(await canAccessFacility(c, req.session.user, facilityId))) return res.status(403).json({ error: 'You cannot access appointments for this facility.' });
    await c.query("UPDATE patient_appointments SET status='missed', updated_at=NOW() WHERE facility_id=$1 AND status='scheduled' AND appointment_date<CURRENT_DATE", [facilityId]);
    const result = await c.query(`
      WITH missed AS (
        SELECT patient_id,COUNT(*)::int AS missed_visits,MAX(appointment_date) AS last_missed_date
        FROM patient_appointments WHERE facility_id=$1 AND status='missed' GROUP BY patient_id
      ), ranked AS (
        SELECT patient_id,status,ROW_NUMBER() OVER(PARTITION BY patient_id ORDER BY appointment_date DESC,created_at DESC) rn
        FROM patient_appointments WHERE facility_id=$1 AND appointment_date<=CURRENT_DATE AND status IN ('missed','completed')
      ), streak AS (
        SELECT r.patient_id,COUNT(*) FILTER(WHERE r.status='missed')::int consecutive_missed
        FROM ranked r
        WHERE r.rn<COALESCE((SELECT MIN(r2.rn) FROM ranked r2 WHERE r2.patient_id=r.patient_id AND r2.status='completed'),999)
        GROUP BY r.patient_id
      ), next_visit AS (
        SELECT DISTINCT ON(patient_id) patient_id,appointment_date,appointment_type,purpose
        FROM patient_appointments WHERE facility_id=$1 AND status='scheduled' AND appointment_date>=CURRENT_DATE
        ORDER BY patient_id,appointment_date
      )
      SELECT p.id AS patient_id,p.patient_code,p.full_name,p.phone,m.missed_visits,
        m.last_missed_date AS last_visit_date,n.appointment_date AS next_visit_date,
        n.appointment_type,n.purpose,
        CASE WHEN COALESCE(s.consecutive_missed,0)>=2 THEN 'red' ELSE 'yellow' END AS risk
      FROM missed m JOIN patients p ON p.id=m.patient_id
      LEFT JOIN streak s ON s.patient_id=m.patient_id LEFT JOIN next_visit n ON n.patient_id=m.patient_id
      ORDER BY CASE WHEN COALESCE(s.consecutive_missed,0)>=2 THEN 0 ELSE 1 END,m.last_missed_date ASC
      LIMIT 300
    `, [facilityId]); [facilityId]);
    res.json({ followUps: result.rows });
  } catch (e) { next(e); } finally { c.release(); }
});

router.post('/appointments', async (req, res, next) => {
  const c = await pool.connect();
  try {
    const d = req.body, facilityId = String(d.facilityId || ''), patientId = String(d.patientId || '');
    const date = String(d.appointmentDate || ''), type = String(d.appointmentType || 'general');
    const operationId = opId(d.operationId);
    if (!facilityId || !patientId || !validDate(date) || !['general','anc','immunization','chronic_care','review'].includes(type)) return res.status(400).json({ error: 'Select a patient, appointment type and valid date.' });
    if (!(await canAccessFacility(c, req.session.user, facilityId))) return res.status(403).json({ error: 'You cannot create appointments for this facility.' });
    const patient = await c.query('SELECT id FROM patients WHERE id=$1 AND facility_id=$2', [patientId, facilityId]);
    if (!patient.rowCount) return res.status(404).json({ error: 'Patient was not found at this facility.' });
    const result = await c.query(`INSERT INTO patient_appointments(facility_id,patient_id,appointment_type,appointment_date,purpose,created_by,operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) DO NOTHING RETURNING *`,
      [facilityId, patientId, type, date, String(d.purpose || 'Follow-up visit').trim().slice(0,240), req.session.user.id, operationId]);
    if (!result.rowCount) return res.json({ duplicate: true, operationId });
    res.status(201).json({ appointment: result.rows[0] });
  } catch (e) { next(e); } finally { c.release(); }
});

router.patch('/appointments/:id', async (req, res, next) => {
  const c = await pool.connect();
  try {
    const status = String(req.body.status || '');
    if (!['completed','cancelled','missed'].includes(status)) return res.status(400).json({ error: 'Invalid appointment status.' });
    const found = await c.query('SELECT facility_id FROM patient_appointments WHERE id=$1', [req.params.id]);
    if (!found.rowCount || !(await canAccessFacility(c, req.session.user, found.rows[0].facility_id))) return res.status(404).json({ error: 'Appointment not found.' });
    const result = await c.query('UPDATE patient_appointments SET status=$1,completed_at=CASE WHEN $1=\'completed\' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$2 RETURNING *', [status, req.params.id]);
    res.json({ appointment: result.rows[0] });
  } catch (e) { next(e); } finally { c.release(); }
});

router.get('/stock-settings', async (req, res, next) => {
  const c = await pool.connect();
  try {
    const facilityId = String(req.query.facilityId || '');
    if (!facilityId || !(await canAccessFacility(c, req.session.user, facilityId))) return res.status(403).json({ error: 'You cannot access this facility.' });
    const result = await c.query(`SELECT b.item_id,b.name,b.unit,b.quantity,
      COALESCE(s.average_use_per_week,0)::numeric AS average_use_per_week,
      COALESCE(s.date_added,CURRENT_DATE) AS date_added,
      CASE WHEN COALESCE(s.average_use_per_week,0)>0 THEN ROUND((b.quantity/(s.average_use_per_week/7.0))::numeric,1) ELSE NULL END AS days_left
      FROM (SELECT i.id AS item_id,i.name,i.unit,COALESCE(SUM(m.quantity_delta),0)::numeric AS quantity
        FROM inventory_items i LEFT JOIN stock_movements m ON m.item_id=i.id AND m.facility_id=$1
        WHERE i.is_active=TRUE GROUP BY i.id,i.name,i.unit) b
      LEFT JOIN inventory_item_facility_settings s ON s.facility_id=$1 AND s.item_id=b.item_id ORDER BY b.name`, [facilityId]);
    res.json({ items: result.rows });
  } catch (e) { next(e); } finally { c.release(); }
});

router.put('/stock-settings/:itemId', async (req, res, next) => {
  const c = await pool.connect();
  try {
    const facilityId = String(req.body.facilityId || ''), use = Number(req.body.averageUsePerWeek), date = String(req.body.dateAdded || '');
    if (!facilityId || !Number.isFinite(use) || use < 0 || !validDate(date)) return res.status(400).json({ error: 'Enter valid weekly use and date added.' });
    if (!(await canAccessFacility(c, req.session.user, facilityId))) return res.status(403).json({ error: 'You cannot update this facility.' });
    const item = await c.query('SELECT id FROM inventory_items WHERE id=$1 AND is_active=TRUE', [req.params.itemId]);
    if (!item.rowCount) return res.status(404).json({ error: 'Inventory item not found.' });
    const result = await c.query(`INSERT INTO inventory_item_facility_settings(facility_id,item_id,average_use_per_week,date_added,updated_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(facility_id,item_id) DO UPDATE SET average_use_per_week=EXCLUDED.average_use_per_week,date_added=EXCLUDED.date_added,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,
      [facilityId, req.params.itemId, use, date, req.session.user.id]);
    res.json({ setting: result.rows[0] });
  } catch (e) { next(e); } finally { c.release(); }
});

router.post('/restock-requests', async (req, res, next) => {
  const c = await pool.connect();
  try {
    const d = req.body, facilityId = String(d.facilityId || ''), itemId = String(d.itemId || '');
    const quantity = d.requestedQuantity == null || d.requestedQuantity === '' ? null : Number(d.requestedQuantity);
    if (!facilityId || !itemId || (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))) return res.status(400).json({ error: 'Select an item and enter a valid quantity.' });
    if (!(await canAccessFacility(c, req.session.user, facilityId))) return res.status(403).json({ error: 'You cannot request stock for this facility.' });
    const operationId = opId(d.operationId);
    const result = await c.query(`INSERT INTO restock_requests(facility_id,item_id,requested_quantity,urgency,notes,requested_by,operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) DO NOTHING RETURNING *`,
      [facilityId,itemId,quantity,d.urgency==='urgent'?'urgent':'normal',String(d.notes||'').slice(0,500),req.session.user.id,operationId]);
    res.status(result.rowCount?201:200).json({ request: result.rows[0] || null, duplicate: !result.rowCount });
  } catch (e) { next(e); } finally { c.release(); }
});
module.exports = router;

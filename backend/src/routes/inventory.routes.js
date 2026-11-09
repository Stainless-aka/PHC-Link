const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

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

router.get('/items', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, category, unit, default_minimum_stock
       FROM inventory_items WHERE is_active = TRUE ORDER BY category, name`
    );
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

router.get('/balances', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const facilityId = req.query.facilityId;
    if (!facilityId) return res.status(400).json({ error: 'facilityId is required.' });
    if (!(await canAccessFacility(client, req.session.user, facilityId))) {
      return res.status(403).json({ error: 'You cannot access this facility.' });
    }
    const result = await client.query(
      `SELECT i.id AS item_id, i.name, i.category, i.unit,
              COALESCE(SUM(m.quantity_delta), 0)::numeric AS quantity,
              COALESCE(MAX(m.created_at), f.created_at) AS last_movement_at
       FROM inventory_items i CROSS JOIN facilities f
       LEFT JOIN stock_movements m ON m.item_id = i.id AND m.facility_id = f.id
       WHERE f.id = $1 AND i.is_active = TRUE
       GROUP BY i.id, i.name, i.category, i.unit, f.created_at
       ORDER BY i.category, i.name`, [facilityId]
    );
    res.json({ facilityId, balances: result.rows });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.post('/movements', requireRole('health_worker', 'clinician', 'lga_officer', 'state_admin', 'system_admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      operationId = randomUUID(), facilityId, itemId, movementType,
      quantity, adjustmentDirection = 'increase', unit, batchNumber = null, expiryDate = null, note = null,
      occurredAt = null
    } = req.body;

    const allowed = ['RECEIVED', 'DISPENSED', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'EXPIRED', 'DAMAGED'];
    const amount = Number(quantity);
    if (!facilityId || !itemId || !allowed.includes(movementType) || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid facility, item, movement type and positive quantity are required.' });
    }
    if (movementType === 'ADJUSTMENT' && (!note || !['increase', 'decrease'].includes(adjustmentDirection))) {
      return res.status(400).json({ error: 'A reason and adjustment direction (increase/decrease) are required.' });
    }
    if (unit && typeof unit !== 'string') return res.status(400).json({ error: 'Invalid unit.' });

    const sign = ['RECEIVED', 'TRANSFER_IN'].includes(movementType) ? 1 : -1;
    const delta = movementType === 'ADJUSTMENT'
      ? amount * (adjustmentDirection === 'increase' ? 1 : -1)
      : amount * sign;

    await client.query('BEGIN');
    if (!(await canAccessFacility(client, req.session.user, facilityId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot record stock for this facility.' });
    }

    const existing = await client.query('SELECT id FROM sync_operations WHERE operation_id = $1', [operationId]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(200).json({ duplicate: true, movementId: existing.rows[0].id });
    }

    const item = await client.query('SELECT id, unit FROM inventory_items WHERE id = $1 AND is_active = TRUE', [itemId]);
    if (!item.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    if (unit && unit !== item.rows[0].unit) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Submitted unit does not match the inventory catalogue.' });
    }

    // Serialize movements for the same facility/item pair so concurrent offline
    // sync requests cannot both spend the same recorded stock balance.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [facilityId, itemId]
    );

    if (delta < 0) {
      const balanceResult = await client.query(
        `SELECT COALESCE(SUM(quantity_delta), 0)::numeric AS balance
         FROM stock_movements WHERE facility_id = $1 AND item_id = $2`,
        [facilityId, itemId]
      );
      if (Number(balanceResult.rows[0].balance) < Math.abs(delta)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Insufficient recorded stock for this movement.' });
      }
    }

    const inserted = await client.query(
      `INSERT INTO stock_movements
       (facility_id, item_id, user_id, movement_type, quantity_delta, batch_number, expiry_date, note, operation_id, device_occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, facility_id, item_id, movement_type, quantity_delta, created_at`,
      [facilityId, itemId, req.session.user.id, movementType, delta, batchNumber, expiryDate, note, operationId, occurredAt]
    );
    await client.query(
      `INSERT INTO sync_operations (operation_id, user_id, facility_id, operation_type, status)
       VALUES ($1,$2,$3,'STOCK_MOVEMENT','processed')`,
      [operationId, req.session.user.id, facilityId]
    );
    await client.query('COMMIT');
    res.status(201).json({ movement: inserted.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'This operation has already been processed.' });
    next(error);
  } finally { client.release(); }
});

module.exports = router;

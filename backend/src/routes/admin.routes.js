const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth, requireRole('system_admin', 'state_admin'));

router.get('/overview', async (req, res, next) => {
  try {
    const [states, lgas, facilities, users, items, referrals] = await Promise.all([
      pool.query('SELECT id, name, code FROM states ORDER BY name'),
      pool.query('SELECT l.id, l.name, l.state_id, s.name AS state_name FROM lgas l JOIN states s ON s.id=l.state_id ORDER BY s.name,l.name'),
      pool.query('SELECT f.id,f.name,f.code,f.lga_id,l.name AS lga_name,s.name AS state_name FROM facilities f JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id WHERE f.is_active=TRUE ORDER BY s.name,l.name,f.name'),
      pool.query('SELECT id,full_name,email,role,phone,is_active FROM users ORDER BY full_name'),
      pool.query('SELECT id,name,category,unit,default_minimum_stock FROM inventory_items WHERE is_active=TRUE ORDER BY category,name'),
      pool.query('SELECT count(*)::int AS count FROM referrals')
    ]);
    res.json({ states:states.rows, lgas:lgas.rows, facilities:facilities.rows, users:users.rows, items:items.rows, referralCount:referrals.rows[0].count });
  } catch (error) { next(error); }
});

router.post('/states', async (req,res,next) => {
  try {
    const name=String(req.body.name||'').trim();
    const code=req.body.code ? String(req.body.code).trim().toUpperCase() : null;
    if(!name) return res.status(400).json({error:'State name is required.'});
    const result=await pool.query('INSERT INTO states(name,code) VALUES($1,$2) RETURNING *',[name,code]);
    res.status(201).json({state:result.rows[0]});
  } catch(error){ if(error.code==='23505') return res.status(409).json({error:'State already exists.'}); next(error); }
});

router.post('/lgas', async (req,res,next) => {
  try {
    const {stateId}=req.body; const name=String(req.body.name||'').trim();
    if(!stateId||!name) return res.status(400).json({error:'State and LGA name are required.'});
    const result=await pool.query('INSERT INTO lgas(state_id,name) VALUES($1,$2) RETURNING *',[stateId,name]);
    res.status(201).json({lga:result.rows[0]});
  } catch(error){ if(error.code==='23503') return res.status(404).json({error:'State not found.'}); if(error.code==='23505') return res.status(409).json({error:'LGA already exists in this state.'}); next(error); }
});

router.post('/facilities', async (req,res,next) => {
  try {
    const {lgaId}=req.body; const name=String(req.body.name||'').trim(); const code=String(req.body.code||'').trim().toUpperCase();
    const address=req.body.address ? String(req.body.address).trim() : null;
    if(!lgaId||!name||!code) return res.status(400).json({error:'LGA, facility name and unique facility code are required.'});
    const result=await pool.query('INSERT INTO facilities(lga_id,name,code,address) VALUES($1,$2,$3,$4) RETURNING *',[lgaId,name,code,address]);
    res.status(201).json({facility:result.rows[0]});
  } catch(error){ if(error.code==='23503') return res.status(404).json({error:'LGA not found.'}); if(error.code==='23505') return res.status(409).json({error:'Facility code already exists.'}); next(error); }
});

router.post('/users', async (req,res,next) => {
  try {
    const {fullName,email,password,role,facilityId,lgaId,phone=null}=req.body;
    const allowed=['health_worker','clinician','lga_officer','state_admin'];
    if(!String(fullName||'').trim()||!String(email||'').trim()||!password||password.length<12||!allowed.includes(role))
      return res.status(400).json({error:'Name, email, role and a password of at least 12 characters are required.'});
    if(role==='health_worker'||role==='clinician'){ if(!facilityId) return res.status(400).json({error:'Select a facility for this user.'}); }
    if(role==='lga_officer'&&!lgaId) return res.status(400).json({error:'Select an LGA for this officer.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const hash=await bcrypt.hash(password,12);
      const created=await client.query(
        'INSERT INTO users(full_name,email,password_hash,role,phone) VALUES($1,lower($2),$3,$4,$5) RETURNING id,full_name,email,role,phone,is_active',
        [String(fullName).trim(),String(email).trim(),hash,role,phone]
      );
      if(facilityId&&(role==='health_worker'||role==='clinician'))
        await client.query('INSERT INTO facility_users(facility_id,user_id) VALUES($1,$2)',[facilityId,created.rows[0].id]);
      if(lgaId&&role==='lga_officer')
        await client.query('INSERT INTO user_lga_access(user_id,lga_id) VALUES($1,$2)',[created.rows[0].id,lgaId]);
      await client.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4)',[req.session.user.id,'USER_CREATED','user',created.rows[0].id]);
      await client.query('COMMIT');
      res.status(201).json({user:created.rows[0]});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')return res.status(409).json({error:'An account with that email already exists.'});if(error.code==='23503')return res.status(404).json({error:'Selected facility or LGA was not found.'});throw error;}
    finally{client.release();}
  }catch(error){next(error);}
});

router.post('/inventory-items', async(req,res,next)=>{
  try{
    const {name,category,unit,minimumStock=0}=req.body;
    if(!String(name||'').trim()||!String(category||'').trim()||!String(unit||'').trim()||!Number.isFinite(Number(minimumStock))||Number(minimumStock)<0)
      return res.status(400).json({error:'Name, category, unit and a non-negative minimum stock are required.'});
    const result=await pool.query(
      'INSERT INTO inventory_items(name,category,unit,default_minimum_stock) VALUES($1,$2,$3,$4) RETURNING id,name,category,unit,default_minimum_stock',
      [String(name).trim(),String(category).trim(),String(unit).trim(),Number(minimumStock)]
    );
    res.status(201).json({item:result.rows[0]});
  }catch(error){if(error.code==='23505')return res.status(409).json({error:'That inventory item and unit already exist.'});next(error);}
});

module.exports=router;

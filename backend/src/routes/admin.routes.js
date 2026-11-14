const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth, requireRole('system_admin'));

router.get('/overview', async (req, res, next) => {
  try {
    const [states, lgas, facilities, users, items, referrals, referralRecords, patientRecords] = await Promise.all([
      pool.query('SELECT id, name, code FROM states ORDER BY name'),
      pool.query('SELECT l.id, l.name, l.state_id, s.name AS state_name FROM lgas l JOIN states s ON s.id=l.state_id ORDER BY s.name,l.name'),
      pool.query('SELECT f.id,f.name,f.code,f.lga_id,f.latitude,f.longitude,f.coordinates_are_approximate,l.name AS lga_name,s.name AS state_name FROM facilities f JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id WHERE f.is_active=TRUE ORDER BY s.name,l.name,f.name'),
      pool.query(`SELECT u.id,u.full_name,u.email,u.role,u.designation,u.phone,u.is_active,u.can_respond_emergency, COALESCE(array_agg(DISTINCT f.name) FILTER (WHERE f.id IS NOT NULL), ARRAY[]::text[]) AS assigned_facilities FROM users u LEFT JOIN facility_users fu ON fu.user_id=u.id AND fu.is_active=TRUE LEFT JOIN facilities f ON f.id=fu.facility_id AND f.is_active=TRUE GROUP BY u.id ORDER BY u.full_name`),
      pool.query('SELECT id,name,category,unit,default_minimum_stock FROM inventory_items WHERE is_active=TRUE ORDER BY category,name'),
      pool.query('SELECT count(*)::int AS count FROM referrals'),
      pool.query(`SELECT r.id,r.referral_code,r.reason_code,r.urgency,r.status,r.created_at,r.updated_at,
                         src.name AS origin_facility,dst.name AS destination_facility,
                         src_lga.name AS origin_lga,dst_lga.name AS destination_lga,
                         u.full_name AS created_by_name
                  FROM referrals r
                  JOIN facilities src ON src.id=r.origin_facility_id
                  JOIN facilities dst ON dst.id=r.destination_facility_id
                  JOIN lgas src_lga ON src_lga.id=src.lga_id
                  JOIN lgas dst_lga ON dst_lga.id=dst.lga_id
                  LEFT JOIN users u ON u.id=r.created_by
                  ORDER BY r.created_at DESC LIMIT 250`),
      pool.query(`SELECT f.id AS facility_id,f.name AS facility_name,l.name AS lga_name,s.name AS state_name,
                         COUNT(p.id)::int AS patient_count
                  FROM facilities f JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id
                  LEFT JOIN patients p ON p.facility_id=f.id
                  GROUP BY f.id,f.name,l.name,s.name ORDER BY s.name,l.name,f.name`)
    ]);
    res.json({ states:states.rows, lgas:lgas.rows, facilities:facilities.rows, users:users.rows, items:items.rows, referralCount:referrals.rows[0].count, referrals:referralRecords.rows, patientCounts:patientRecords.rows, patientCount:patientRecords.rows.reduce((sum,row)=>sum+Number(row.patient_count||0),0) });
  } catch (error) { next(error); }
});

router.get('/facilities/:facilityId/patients', async (req,res,next) => {
  try {
    const facilityId=String(req.params.facilityId||'').trim();
    const page=Math.max(1,Number.parseInt(req.query.page,10)||1);
    const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||50));
    const search=String(req.query.q||'').trim().slice(0,120);
    const facility=await pool.query('SELECT id FROM facilities WHERE id=$1 AND is_active=TRUE',[facilityId]);
    if(!facility.rowCount)return res.status(404).json({error:'Active facility not found.'});
    const pattern='%'+search+'%';
    const [count,patients]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM patients p WHERE p.facility_id=$1 AND ($2='' OR p.patient_code ILIKE $3 OR p.full_name ILIKE $3 OR COALESCE(p.phone,'') ILIKE $3)`,[facilityId,search,pattern]),
      pool.query(`SELECT p.id,p.patient_code,p.full_name,p.age_years,p.sex,p.phone,p.created_at
                  FROM patients p
                  WHERE p.facility_id=$1 AND ($2='' OR p.patient_code ILIKE $3 OR p.full_name ILIKE $3 OR COALESCE(p.phone,'') ILIKE $3)
                  ORDER BY p.created_at DESC LIMIT $4 OFFSET $5`,[facilityId,search,pattern,limit,(page-1)*limit])
    ]);
    const total=count.rows[0].total;
    res.json({patients:patients.rows,total,page,limit,hasMore:page*limit<total});
  } catch(error){next(error);}
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
    const latitude=req.body.latitude===null||req.body.latitude===undefined||req.body.latitude===''?null:Number(req.body.latitude);
    const longitude=req.body.longitude===null||req.body.longitude===undefined||req.body.longitude===''?null:Number(req.body.longitude);
    const coordinatesAreApproximate=req.body.coordinatesAreApproximate===true||req.body.coordinatesAreApproximate==='true';
    if(!lgaId||!name||!code) return res.status(400).json({error:'LGA, facility name and unique facility code are required.'});
    if((latitude===null)!==(longitude===null))return res.status(400).json({error:'Enter both latitude and longitude, or leave both blank.'});
    if(latitude!==null&&(!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180))return res.status(400).json({error:'Enter valid GPS coordinates.'});
    const result=await pool.query('INSERT INTO facilities(lga_id,name,code,address,latitude,longitude,coordinates_are_approximate) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[lgaId,name,code,address,latitude,longitude,latitude===null?false:coordinatesAreApproximate]);
    res.status(201).json({facility:result.rows[0]});
  } catch(error){ if(error.code==='23503') return res.status(404).json({error:'LGA not found.'}); if(error.code==='23505') return res.status(409).json({error:'Facility code already exists.'}); next(error); }
});


function validId(value){return String(value||'').trim().length>0;}
router.patch('/states/:id',async(req,res,next)=>{try{const name=String(req.body.name||'').trim(),code=req.body.code===undefined?null:(String(req.body.code||'').trim().toUpperCase()||null);if(!name)return res.status(400).json({error:'State name is required.'});const r=await pool.query('UPDATE states SET name=$1,code=COALESCE($2,code) WHERE id=$3 RETURNING id,name,code',[name,code,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'State not found.'});await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'STATE_UPDATED','state',$2)",[req.session.user.id,req.params.id]);res.json({state:r.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({error:'State name or code already exists.'});next(e);}});
router.delete('/states/:id',async(req,res,next)=>{try{const r=await pool.query('DELETE FROM states WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'State not found.'});await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'STATE_DELETED','state',$2)",[req.session.user.id,req.params.id]);res.json({success:true});}catch(e){if(e.code==='23503')return res.status(409).json({error:'State still has LGAs or linked records. Remove or move them first.'});next(e);}});
router.patch('/lgas/:id',async(req,res,next)=>{try{const name=String(req.body.name||'').trim(),stateId=validId(req.body.stateId)?req.body.stateId:null;if(!name)return res.status(400).json({error:'LGA name is required.'});const r=await pool.query('UPDATE lgas SET name=$1,state_id=COALESCE($2,state_id) WHERE id=$3 RETURNING id,name,state_id',[name,stateId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'LGA not found.'});await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'LGA_UPDATED','lga',$2)",[req.session.user.id,req.params.id]);res.json({lga:r.rows[0]});}catch(e){if(e.code==='23503')return res.status(404).json({error:'Selected state not found.'});if(e.code==='23505')return res.status(409).json({error:'LGA already exists in that state.'});next(e);}});
router.delete('/lgas/:id',async(req,res,next)=>{try{const r=await pool.query('DELETE FROM lgas WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'LGA not found.'});await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'LGA_DELETED','lga',$2)",[req.session.user.id,req.params.id]);res.json({success:true});}catch(e){if(e.code==='23503')return res.status(409).json({error:'LGA still has facilities or linked records. Move or remove them first.'});next(e);}});
router.patch('/facilities/:id',async(req,res,next)=>{try{const name=String(req.body.name||'').trim(),code=String(req.body.code||'').trim().toUpperCase(),lgaId=validId(req.body.lgaId)?req.body.lgaId:null;if(!name||!code)return res.status(400).json({error:'Facility name and code are required.'});const r=await pool.query('UPDATE facilities SET name=$1,code=$2,lga_id=COALESCE($3,lga_id) WHERE id=$4 RETURNING id,name,code,lga_id',[name,code,lgaId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Facility not found.'});await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'FACILITY_UPDATED','facility',$2)",[req.session.user.id,req.params.id]);res.json({facility:r.rows[0]});}catch(e){if(e.code==='23503')return res.status(404).json({error:'Selected LGA not found.'});if(e.code==='23505')return res.status(409).json({error:'Facility code already exists.'});next(e);}});
router.delete('/facilities/:id',async(req,res,next)=>{try{const r=await pool.query('DELETE FROM facilities WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Facility not found.'});await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'FACILITY_DELETED','facility',$2)",[req.session.user.id,req.params.id]);res.json({success:true});}catch(e){if(e.code==='23503')return res.status(409).json({error:'Facility has linked patients, referrals, staff or stock records. Reassign these records first.'});next(e);}});

router.post('/users', async (req,res,next) => {
  try {
    const {fullName,email,password,role,facilityId,lgaId,phone=null,designation=null,canRespondEmergency=false}=req.body;
    const allowed=['health_worker','clinician','lga_officer'];
    if(!String(fullName||'').trim()||!String(email||'').trim()||!password||password.length<12||!allowed.includes(role))
      return res.status(400).json({error:'Name, email, role and a password of at least 12 characters are required.'});
    if(role==='health_worker'||role==='clinician'){ if(!facilityId) return res.status(400).json({error:'Select a facility for this user.'}); }
    if(role==='lga_officer'&&!lgaId) return res.status(400).json({error:'Select an LGA for this officer.'});
    const allowedDesignations=['doctor','medical_officer','nurse','midwife','chew','cho'];
    if(designation&&!allowedDesignations.includes(designation)) return res.status(400).json({error:'Select a valid professional designation.'});
    if(role==='clinician'&&!['doctor','medical_officer','nurse','midwife','chew','cho'].includes(designation)) return res.status(400).json({error:'Clinician accounts require a valid professional designation.'});
    if((canRespondEmergency===true||canRespondEmergency==='true')&&(!designation||role!=='health_worker')) return res.status(400).json({error:'Clinical referral access requires a health worker account and a professional designation.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const hash=await bcrypt.hash(password,12);
      const created=await client.query(
        'INSERT INTO users(full_name,email,password_hash,role,phone,designation,can_respond_emergency) VALUES($1,lower($2),$3,$4,$5,$6,$7) RETURNING id,full_name,email,role,phone,designation,can_respond_emergency,is_active',
        [String(fullName).trim(),String(email).trim(),hash,role,phone,designation||null,(canRespondEmergency===true||canRespondEmergency==='true')]
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


router.post('/users/:userId/facilities', async (req,res,next)=>{
  const facilityId=String(req.body.facilityId||'').trim();
  if(!facilityId)return res.status(400).json({error:'Select a facility to assign.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const user=await client.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE',[req.params.userId]);
    if(!user.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'User account not found.'});}
    if(!['health_worker','clinician'].includes(user.rows[0].role)){await client.query('ROLLBACK');return res.status(400).json({error:'Facilities can only be assigned to health workers and clinicians.'});}
    const facility=await client.query('SELECT id FROM facilities WHERE id=$1 AND is_active=TRUE',[facilityId]);
    if(!facility.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active facility not found.'});}
    // A health worker or clinician may have only one active facility at a time.
    await client.query('UPDATE facility_users SET is_active=FALSE WHERE user_id=$1 AND is_active=TRUE AND facility_id<>$2',[req.params.userId,facilityId]);
    await client.query('INSERT INTO facility_users(facility_id,user_id,is_active) VALUES($1,$2,TRUE) ON CONFLICT(facility_id,user_id) DO UPDATE SET is_active=TRUE,assigned_at=NOW()',[facilityId,req.params.userId]);
    await client.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[req.session.user.id,'USER_FACILITY_ASSIGNED','user',req.params.userId,JSON.stringify({facilityId})]);
    const assignments=await client.query('SELECT f.id,f.name FROM facility_users fu JOIN facilities f ON f.id=fu.facility_id WHERE fu.user_id=$1 AND fu.is_active=TRUE AND f.is_active=TRUE ORDER BY f.name',[req.params.userId]);
    await client.query('COMMIT');
    res.json({facilities:assignments.rows});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});next(error);}
  finally{client.release();}
});


router.patch('/users/:userId/role', async (req,res,next)=>{
  if(req.params.userId===req.session.user.id)return res.status(400).json({error:'You cannot change your own administrator role.'});
  const allowed=['health_worker','clinician','lga_officer','state_admin','system_admin'];
  const role=String(req.body.role||'');
  if(!allowed.includes(role))return res.status(400).json({error:'Select a valid account role.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT designation FROM users WHERE id=$1 FOR UPDATE',[req.params.userId]);
    if(!existing.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'User account not found.'});}
    if(role==='clinician'&&!['doctor','medical_officer','nurse','midwife','chew','cho'].includes(existing.rows[0].designation)){await client.query('ROLLBACK');return res.status(400).json({error:'Set a professional designation before assigning the Clinician role.'});}
    const updated=await client.query(`UPDATE users SET role=$1, designation=CASE WHEN $1 IN ('health_worker','clinician') THEN designation ELSE NULL END, can_respond_emergency=CASE WHEN $1='health_worker' THEN can_respond_emergency ELSE FALSE END, updated_at=NOW() WHERE id=$2 RETURNING id,full_name,email,role,is_active,designation,can_respond_emergency`,[role,req.params.userId]);
    if(!updated.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'User account not found.'});}
    if(role==='health_worker'||role==='clinician') await client.query('DELETE FROM user_lga_access WHERE user_id=$1',[req.params.userId]);
    else {
      await client.query('DELETE FROM facility_users WHERE user_id=$1',[req.params.userId]);
      await client.query('DELETE FROM user_lga_access WHERE user_id=$1',[req.params.userId]);
    }
    await client.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[req.session.user.id,'USER_ROLE_CHANGED','user',req.params.userId,JSON.stringify({role})]);
    await client.query('COMMIT');res.json({user:updated.rows[0]});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});next(error);}
  finally{client.release();}
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

router.patch('/users/:userId/designation', async (req,res,next)=>{
  const allowed=['doctor','medical_officer','nurse','midwife','chew','cho' ,null,''];
  const designation=req.body.designation||null;
  if(!allowed.includes(designation))return res.status(400).json({error:'Select a valid professional designation.'});
  try{
    const result=await pool.query(
      `UPDATE users SET designation=$1::text,
         can_respond_emergency=CASE WHEN $1::text IS NULL THEN FALSE ELSE can_respond_emergency END,
         updated_at=NOW()
       WHERE id=$2 AND role IN ('health_worker','clinician')
       RETURNING id,designation,can_respond_emergency`,
      [designation,req.params.userId]
    );
    if(!result.rowCount)return res.status(404).json({error:'Health worker account not found.'});
    await pool.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[req.session.user.id,'USER_DESIGNATION_CHANGED','user',req.params.userId,JSON.stringify({designation})]);
    res.json({user:result.rows[0]});
  }catch(error){next(error);}
});

router.patch('/users/:userId/clinical-access', async (req,res,next)=>{
  const enabled=req.body.canRespondEmergency===true||req.body.canRespondEmergency==='true';
  try{
    const result=await pool.query(
      `UPDATE users SET can_respond_emergency=$1,updated_at=NOW()
       WHERE id=$2 AND role='health_worker'
         AND ($1=FALSE OR designation IS NOT NULL)
       RETURNING id,can_respond_emergency`,
      [enabled,req.params.userId]
    );
    if(!result.rowCount)return res.status(400).json({error:'Clinical referral access requires a health worker with a professional designation.'});
    await pool.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[req.session.user.id,'USER_CLINICAL_ACCESS_CHANGED','user',req.params.userId,JSON.stringify({canRespondEmergency:enabled})]);
    res.json({user:result.rows[0]});
  }catch(error){next(error);}
});

router.post('/referrals/:id/approve',async(req,res,next)=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query('SELECT id,referral_code,status FROM referrals WHERE id=$1 FOR UPDATE',[req.params.id]);if(!r.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Referral not found.'});}if(r.rows[0].status!=='submitted'){await c.query('ROLLBACK');return res.status(409).json({error:'Only submitted referrals can be approved.'});}const updated=await c.query("UPDATE referrals SET status='acknowledged',updated_at=NOW() WHERE id=$1 RETURNING id,referral_code,status,updated_at",[req.params.id]);await c.query("INSERT INTO referral_events(referral_id,event_type,actor_user_id,notes) VALUES($1,'acknowledged',$2,'Approved by system administrator for transfer.')",[req.params.id,req.session.user.id]);await c.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'REFERRAL_ADMIN_APPROVED','referral',$2)",[req.session.user.id,req.params.id]);await c.query('COMMIT');res.json({referral:updated.rows[0]});}catch(e){await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c.release();}});

router.get('/health-tips', async (req,res,next) => {
  try {
    const result=await pool.query('SELECT id,english_text,hausa_text,source_name,source_url,is_active,created_at FROM health_tips ORDER BY created_at DESC LIMIT 200');
    res.json({tips:result.rows});
  } catch(error){next(error);}
});
router.post('/health-tips', async (req,res,next) => {
  try {
    const english=String(req.body.english_text||'').trim(),hausa=String(req.body.hausa_text||'').trim();
    const source=String(req.body.source_name||'PHC Link').trim().slice(0,120),sourceUrl=req.body.source_url?String(req.body.source_url).trim():null;
    if(english.length<8||english.length>1000||hausa.length>1000)return res.status(400).json({error:'Enter an English tip and keep each language within 1,000 characters.'});
    if(sourceUrl&&!/^https:\/\//i.test(sourceUrl))return res.status(400).json({error:'Source URL must use HTTPS.'});
    const result=await pool.query('INSERT INTO health_tips(english_text,hausa_text,source_name,source_url,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,english_text,hausa_text,source_name,source_url,is_active,created_at',[english,hausa,source,sourceUrl,req.session.user.id]);
    await pool.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,\'HEALTH_TIP_CREATED\',\'health_tip\',$2,$3)',[req.session.user.id,result.rows[0].id,JSON.stringify({source})]);
    res.status(201).json({tip:result.rows[0]});
  } catch(error){next(error);}
});
router.patch('/health-tips/:tipId', async (req,res,next) => {
  try {
    const english=String(req.body.english_text||'').trim(),hausa=String(req.body.hausa_text||'').trim();
    const source=String(req.body.source_name||'PHC Link').trim().slice(0,120),sourceUrl=req.body.source_url?String(req.body.source_url).trim():null,active=req.body.is_active!==false;
    if(english.length<8||english.length>1000||hausa.length>1000)return res.status(400).json({error:'Enter an English tip and keep each language within 1,000 characters.'});
    if(sourceUrl&&!/^https:\/\//i.test(sourceUrl))return res.status(400).json({error:'Source URL must use HTTPS.'});
    const result=await pool.query('UPDATE health_tips SET english_text=$1,hausa_text=$2,source_name=$3,source_url=$4,is_active=$5,updated_at=NOW() WHERE id=$6 RETURNING id,english_text,hausa_text,source_name,source_url,is_active,created_at',[english,hausa,source,sourceUrl,active,req.params.tipId]);
    if(!result.rowCount)return res.status(404).json({error:'Health tip not found.'});
    await pool.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,\'HEALTH_TIP_UPDATED\',\'health_tip\',$2,$3)',[req.session.user.id,req.params.tipId,JSON.stringify({source,isActive:active})]);
    res.json({tip:result.rows[0]});
  } catch(error){next(error);}
});
router.delete('/health-tips/:tipId', async (req,res,next) => {
  try {
    const result=await pool.query('DELETE FROM health_tips WHERE id=$1 RETURNING id',[req.params.tipId]);
    if(!result.rowCount)return res.status(404).json({error:'Health tip not found.'});
    await pool.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,\'HEALTH_TIP_DELETED\',\'health_tip\',$2)',[req.session.user.id,req.params.tipId]);
    res.json({success:true});
  } catch(error){next(error);}
});

module.exports=router;
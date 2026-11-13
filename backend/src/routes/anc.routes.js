const express = require('express');
const { randomUUID, randomInt } = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router = express.Router();
router.use(requireAuth, requireRole('health_worker', 'clinician'));

async function canAccessFacility(client,user,facilityId){
  const r=await client.query(
    \`SELECT 1 FROM facility_users fu JOIN facilities f ON f.id=fu.facility_id
     WHERE fu.user_id=$1 AND fu.facility_id=$2 AND fu.is_active=TRUE AND f.is_active=TRUE\`,
    [user.id,facilityId]
  );
  return r.rowCount>0;
}
async function getPregnancy(client,user,id){
  const r=await client.query(
    \`SELECT p.*,pt.patient_code,pt.full_name,pt.age_years,pt.phone,pt.address,pt.next_of_kin_name,pt.next_of_kin_phone
     FROM anc_pregnancies p JOIN patients pt ON pt.id=p.patient_id WHERE p.id=$1\`,[id]
  );
  if(!r.rowCount||!(await canAccessFacility(client,user,r.rows[0].facility_id)))return null;
  return r.rows[0];
}
function operationId(value){const id=String(value||'');return /^[0-9a-f-]{36}$/i.test(id)?id:null;}
function dateValue(value,label,required=true){
  const v=String(value||'');
  if(!v&& !required)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)
    throw Object.assign(new Error(label+' must be a valid date.'),{status:400});
  return v;
}
function shortText(value,max=2000){const v=String(value||'').trim();if(v.length>max)throw Object.assign(new Error('A text field exceeds the allowed length.'),{status:400});return v||null;}
async function log(client,user,action,type,id,metadata={}) {
  await client.query('INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [user.id,action,type,id,JSON.stringify(metadata)]);
}

router.get('/',async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const facilityId=String(req.query.facilityId||'');
    if(!facilityId||!(await canAccessFacility(client,req.session.user,facilityId)))return res.status(403).json({error:'You cannot access antenatal records at this facility.'});
    await client.query("UPDATE anc_appointments SET status='missed' WHERE facility_id=$1 AND status='scheduled' AND appointment_date<CURRENT_DATE",[facilityId]);
    const [pregnancies,counts]=await Promise.all([
      client.query(\`SELECT p.id,p.patient_id,p.pregnancy_number,p.lmp,p.edd,p.status,p.created_at,
        pt.patient_code,pt.full_name,pt.age_years,
        GREATEST(0,FLOOR(CURRENT_DATE-p.lmp)::int) AS gestational_days,
        EXISTS(SELECT 1 FROM anc_risk_flags rf WHERE rf.pregnancy_id=p.id AND rf.status IN ('open','reviewed')) AS high_risk
        FROM anc_pregnancies p JOIN patients pt ON pt.id=p.patient_id
        WHERE p.facility_id=$1 ORDER BY p.created_at DESC LIMIT 300\`,[facilityId]),
      client.query(\`SELECT
        COUNT(DISTINCT p.id)::int AS registered,
        COUNT(DISTINCT p.id) FILTER(WHERE p.status='active')::int AS active,
        (SELECT COUNT(*)::int FROM anc_visits v WHERE v.facility_id=$1) AS visits,
        COUNT(DISTINCT p.id) FILTER(WHERE EXISTS(SELECT 1 FROM anc_risk_flags r WHERE r.pregnancy_id=p.id AND r.status IN ('open','reviewed')))::int AS high_risk,
        (SELECT COUNT(*)::int FROM anc_appointments a WHERE a.facility_id=$1 AND a.status='missed') AS missed,
        (SELECT COUNT(*)::int FROM anc_deliveries d WHERE d.facility_id=$1) AS deliveries
        FROM anc_pregnancies p WHERE p.facility_id=$1\`,[facilityId])
    ]);
    res.json({pregnancies:pregnancies.rows,analytics:counts.rows[0]});
  }catch(e){next(e);}finally{client.release();}
});

router.post('/registrations',async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const d=req.body,facilityId=String(d.facilityId||''),op=operationId(d.operationId);
    const fullName=String(d.fullName||'').trim().replace(/\s+/g,' ');
    const age=Number(d.ageYears),phone=shortText(d.phone,30),address=shortText(d.address,500);
    const kin=shortText(d.nextOfKinName,160),kinPhone=shortText(d.nextOfKinPhone,30);
    const lmp=dateValue(d.lmp,'Last menstrual period');
    if(!op||fullName.length<2||fullName.length>160||!Number.isInteger(age)||age<10||age>60||!phone||!address||!kin||!kinPhone)
      return res.status(400).json({error:'Complete the woman’s name, age, phone, address, next of kin and valid operation ID.'});
    if(!['health_worker','clinician'].includes(req.session.user.role))return res.status(403).json({error:'Only facility clinical staff can register ANC patients.'});
    const today=new Date();today.setHours(0,0,0,0);
    const lmpDate=new Date(lmp+'T00:00:00');if(lmpDate>today||lmpDate<new Date(today.getTime()-315*86400000))return res.status(400).json({error:'LMP must be within the last 315 days and cannot be in the future.'});
    await client.query('BEGIN');
    if(!(await canAccessFacility(client,req.session.user,facilityId))){await client.query('ROLLBACK');return res.status(403).json({error:'You cannot register ANC patients at this facility.'});}
    const prior=await client.query('SELECT p.id,p.patient_id,p.lmp,p.edd,pt.patient_code,pt.full_name FROM anc_pregnancies p JOIN patients pt ON pt.id=p.patient_id WHERE p.operation_id=$1',[op]);
    if(prior.rowCount){await client.query('COMMIT');return res.json({duplicate:true,pregnancy:prior.rows[0]});}
    const facility=await client.query('SELECT f.code,s.name AS state_name FROM facilities f JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id WHERE f.id=$1 FOR UPDATE OF f',[facilityId]);
    if(!facility.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Facility not found.'});}
    const n=await client.query('SELECT COUNT(*)::int AS n FROM patients WHERE facility_id=$1',[facilityId]);
    const stateCode=/yobe/i.test(facility.rows[0].state_name)?'YB':facility.rows[0].state_name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
    const code=stateCode+'-'+String(facility.rows[0].code).replace(/[^A-Za-z0-9-]/g,'').toUpperCase().replace(/^YB-/,'')+'-'+String(n.rows[0].n+1).padStart(5,'0');
    const pin=String(randomInt(1000,10000)),hash=await bcrypt.hash(pin,12);
    const patient=await client.query(\`INSERT INTO patients(facility_id,patient_code,full_name,age_years,sex,phone,address,next_of_kin_name,next_of_kin_phone,created_by,operation_id,pin_hash)
      VALUES($1,$2,$3,$4,'female',$5,$6,$7,$8,$9,$10,$11) RETURNING id,patient_code,full_name,age_years\`,
      [facilityId,code,fullName,age,phone,address,kin,kinPhone,req.session.user.id,op,hash]);
    const count=await client.query('SELECT COUNT(*)::int AS n FROM anc_pregnancies WHERE patient_id=$1',[patient.rows[0].id]);
    const edd=new Date(lmp+'T00:00:00Z');edd.setUTCDate(edd.getUTCDate()+280);
    const preg=await client.query(\`INSERT INTO anc_pregnancies(patient_id,facility_id,pregnancy_number,lmp,edd,previous_pregnancy_history,registered_by,operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,patient_id,pregnancy_number,lmp,edd,status\`,
      [patient.rows[0].id,facilityId,count.rows[0].n+1,lmp,edd.toISOString().slice(0,10),shortText(d.previousPregnancyHistory,3000),req.session.user.id,op]);
    await log(client,req.session.user,'ANC_PREGNANCY_REGISTERED','anc_pregnancy',preg.rows[0].id,{facilityId,patientCode:code});
    await client.query('COMMIT');
    res.status(201).json({pregnancy:{...preg.rows[0],...patient.rows[0]},patientPin:pin});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'This registration has already been saved.'});if(e.status)return res.status(e.status).json({error:e.message});next(e);}
  finally{client.release();}
});

router.get('/:id',async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const p=await getPregnancy(client,req.session.user,req.params.id);
    if(!p)return res.status(404).json({error:'Pregnancy record not found or access denied.'});
    const [visits,tests,risks,medications,appointments,delivery,postnatal]=await Promise.all([
      client.query('SELECT * FROM anc_visits WHERE pregnancy_id=$1 ORDER BY visit_date DESC,created_at DESC',[p.id]),
      client.query('SELECT * FROM anc_lab_results WHERE pregnancy_id=$1 ORDER BY tested_at DESC,created_at DESC',[p.id]),
      client.query('SELECT * FROM anc_risk_flags WHERE pregnancy_id=$1 ORDER BY created_at DESC',[p.id]),
      client.query('SELECT * FROM anc_medications WHERE pregnancy_id=$1 ORDER BY start_date DESC',[p.id]),
      client.query('SELECT * FROM anc_appointments WHERE pregnancy_id=$1 ORDER BY appointment_date',[p.id]),
      client.query('SELECT * FROM anc_deliveries WHERE pregnancy_id=$1',[p.id]),
      client.query('SELECT * FROM anc_postnatal_visits WHERE pregnancy_id=$1 ORDER BY visit_date DESC',[p.id])
    ]);
    const days=Math.max(0,Math.floor((Date.now()-new Date(p.lmp+'T00:00:00Z').getTime())/86400000));
    res.json({pregnancy:{...p,gestational_days:days,gestational_weeks:Math.floor(days/7),gestational_remainder:days%7},visits:visits.rows,tests:tests.rows,risks:risks.rows,medications:medications.rows,appointments:appointments.rows,delivery:delivery.rows[0]||null,postnatal:postnatal.rows});
  }catch(e){next(e);}finally{client.release();}
});

async function createEntry(req,res,next,table,fields,action){
 const client=await pool.connect();
 try{
  const id=req.params.id,op=operationId(req.body.operationId);if(!op)return res.status(400).json({error:'A valid operation ID is required.'});
  const pregnancy=await getPregnancy(client,req.session.user,id);if(!pregnancy)return res.status(404).json({error:'Pregnancy record not found or access denied.'});
  const exists=await client.query('SELECT id FROM '+table+' WHERE operation_id=$1',[op]);if(exists.rowCount)return res.json({duplicate:true,id:exists.rows[0].id});
  const values=fields(req.body,req.session.user);
  const cols=['pregnancy_id','facility_id',...values.columns,'operation_id'];
  const args=[id,pregnancy.facility_id,...values.values,op];
  const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
  const result=await client.query('INSERT INTO '+table+'('+cols.join(',')+') VALUES('+placeholders+') RETURNING *',args);
  await log(client,req.session.user,action,table,result.rows[0].id,{pregnancyId:id});
  res.status(201).json({record:result.rows[0]});
 }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}finally{client.release();}
}
router.post('/:id/visits',(req,res,next)=>createEntry(req,res,next,'anc_visits',(d,u)=>{
 const date=dateValue(d.visitDate,'Visit date');
 const num=(v,label,min,max)=>{if(v===''||v===undefined||v===null)return null;const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Object.assign(new Error('Invalid '+label+'.'),{status:400});return n;};
 return {columns:['visit_date','weight_kg','systolic_bp','diastolic_bp','temperature_c','clinical_observations','gestational_age_weeks','recorded_by'],values:[date,num(d.weightKg,'weight',1,350),num(d.systolicBp,'systolic blood pressure',40,300),num(d.diastolicBp,'diastolic blood pressure',20,200),num(d.temperatureC,'temperature',30,45),shortText(d.observations,3000),num(d.gestationalAgeWeeks,'gestational age',0,45),u.id]};
},'ANC_VISIT_RECORDED'));
router.post('/:id/tests',(req,res,next)=>createEntry(req,res,next,'anc_lab_results',(d,u)=>{
 const type=String(d.testType||'');const allowed=['blood_group','genotype','hiv','hepatitis_b','malaria','urine','blood_sugar','haemoglobin','other'];
 if(!allowed.includes(type))throw Object.assign(new Error('Select a valid test.'),{status:400});
 const consent=d.consentObtained===true||d.consentObtained==='true';
 if(['hiv','hepatitis_b'].includes(type)&&!consent)throw Object.assign(new Error('Documented consent is required before recording this screening.'),{status:400});
 return {columns:['test_type','result','tested_at','consent_obtained','confidential','notes','recorded_by'],values:[type,shortText(d.result,1000)||'Not recorded',dateValue(d.testedAt,'Test date'),consent,true,shortText(d.notes,1000),u.id]};
},'ANC_TEST_RECORDED'));
router.post('/:id/risks',(req,res,next)=>createEntry(req,res,next,'anc_risk_flags',(d,u)=>{
 const category=String(d.category||''),allowed=['hypertension','severe_anemia','previous_complication','bleeding','severe_headache','visual_changes','fever','reduced_fetal_movement','other'];
 if(!allowed.includes(category))throw Object.assign(new Error('Select a valid risk category.'),{status:400});
 const severity=['moderate','high','urgent'].includes(d.severity)?d.severity:'high';
 return {columns:['category','severity','notes','created_by'],values:[category,severity,shortText(d.notes,2000),u.id]};
},'ANC_RISK_FLAG_CREATED'));
router.patch('/:id/risks/:riskId',async(req,res,next)=>{
 const c=await pool.connect();try{const p=await getPregnancy(c,req.session.user,req.params.id);if(!p)return res.status(404).json({error:'Pregnancy record not found.'});
 const status=String(req.body.status||'');if(!['reviewed','resolved'].includes(status))return res.status(400).json({error:'Select reviewed or resolved.'});
 const r=await c.query("UPDATE anc_risk_flags SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3 AND pregnancy_id=$4 RETURNING *",[status,req.session.user.id,req.params.riskId,p.id]);
 if(!r.rowCount)return res.status(404).json({error:'Risk flag not found.'});await log(c,req.session.user,'ANC_RISK_REVIEWED','anc_risk_flag',r.rows[0].id,{status});res.json({record:r.rows[0]});
 }catch(e){next(e);}finally{c.release();}
});
router.post('/:id/medications',(req,res,next)=>createEntry(req,res,next,'anc_medications',(d,u)=>{
 const name=shortText(d.medicationName,160);if(!name)throw Object.assign(new Error('Medication name is required.'),{status:400});
 const start=dateValue(d.startDate,'Start date'),end=dateValue(d.endDate,'End date',false);if(end&&end<start)throw Object.assign(new Error('End date cannot be before start date.'),{status:400});
 return {columns:['medication_name','dose','frequency','start_date','end_date','instructions','prescribed_by'],values:[name,shortText(d.dose,160),shortText(d.frequency,160),start,end,shortText(d.instructions,1000),u.id]};
},'ANC_MEDICATION_RECORDED'));
router.post('/:id/appointments',(req,res,next)=>createEntry(req,res,next,'anc_appointments',(d,u)=>{
 return {columns:['appointment_date','purpose','created_by'],values:[dateValue(d.appointmentDate,'Appointment date'),shortText(d.purpose,500),u.id]};
},'ANC_APPOINTMENT_SCHEDULED'));
router.post('/:id/delivery',async(req,res,next)=>{
 const c=await pool.connect();try{const p=await getPregnancy(c,req.session.user,req.params.id);if(!p)return res.status(404).json({error:'Pregnancy record not found.'});
 const op=operationId(req.body.operationId);if(!op)return res.status(400).json({error:'Valid operation ID required.'});
 const method=String(req.body.deliveryMethod||''),outcome=String(req.body.birthOutcome||'');
 if(!['vaginal','assisted_vaginal','caesarean','other'].includes(method)||!['live_birth','stillbirth','neonatal_death','other'].includes(outcome))return res.status(400).json({error:'Select valid delivery method and birth outcome.'});
 const r=await c.query(\`INSERT INTO anc_deliveries(pregnancy_id,facility_id,delivery_date,delivery_method,baby_condition,birth_outcome,complications,notes,recorded_by,operation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(pregnancy_id) DO NOTHING RETURNING *\`,
 [p.id,p.facility_id,dateValue(req.body.deliveryDate,'Delivery date'),method,shortText(req.body.babyCondition,1000),outcome,shortText(req.body.complications,2000),shortText(req.body.notes,2000),req.session.user.id,op]);
 if(!r.rowCount){const old=await c.query('SELECT * FROM anc_deliveries WHERE pregnancy_id=$1',[p.id]);return res.json({duplicate:true,record:old.rows[0]});}
 await c.query("UPDATE anc_pregnancies SET status='delivered',updated_at=NOW() WHERE id=$1",[p.id]);
 await log(c,req.session.user,'ANC_DELIVERY_RECORDED','anc_delivery',r.rows[0].id,{pregnancyId:p.id});res.status(201).json({record:r.rows[0]});
 }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}finally{c.release();}
});
router.post('/:id/postnatal',(req,res,next)=>createEntry(req,res,next,'anc_postnatal_visits',(d,u)=>{
 const who=String(d.followUpFor||'');if(!['mother','newborn','both'].includes(who))throw Object.assign(new Error('Select mother, newborn or both.'),{status:400});
 return {columns:['visit_date','follow_up_for','observations','danger_signs','next_visit_date','recorded_by'],values:[dateValue(d.visitDate,'Visit date'),who,shortText(d.observations,2000),shortText(d.dangerSigns,2000),dateValue(d.nextVisitDate,'Next visit date',false),u.id]};
},'ANC_POSTNATAL_VISIT_RECORDED'));

module.exports = router;

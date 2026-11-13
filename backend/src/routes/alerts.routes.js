const express = require('express');
const { timingSafeEqual } = require('crypto');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/require-auth');

const router = express.Router();

const ALERT_CODES = {
  'MAT-LAB': 'red', 'MAT-BLEED': 'red', 'MAT-ECL': 'red',
  'EM-GUN': 'red', 'EM-CUT': 'red', 'EM-RTA': 'red',
  'EM-CLASH': 'red', 'BLD-NEED': 'red', 'SEC-THREAT': 'red',
  'DRG-OUT': 'yellow', 'DRG-LOW': 'yellow', 'IMM-OUT': 'yellow',
  'KIT-OUT': 'yellow', 'KIT-LOW': 'yellow', 'STAFF-NONE': 'yellow',
  'PWR-OUT': 'yellow',
  'MAT-ANC': 'green', 'IMM-DAY': 'green'
};

function validGatewayKey(value) {
  const expected = process.env.ALERT_INGEST_KEY || '';
  if (!expected || !value) return false;
  const a = Buffer.from(String(value));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function canReadFacility(client, user, facilityId) {
  if (['system_admin','state_admin'].includes(user.role)) return true;
  if (user.role === 'lga_officer') {
    const result = await client.query(
      'SELECT 1 FROM facilities f JOIN user_lga_access a ON a.lga_id=f.lga_id WHERE f.id=$1 AND a.user_id=$2',
      [facilityId,user.id]
    );
    return result.rowCount > 0;
  }
  const result = await client.query(
    'SELECT 1 FROM facility_users WHERE facility_id=$1 AND user_id=$2 AND is_active=TRUE',
    [facilityId,user.id]
  );
  return result.rowCount > 0;
}

router.get('/alerts', requireAuth, async (req,res,next) => {
  const client=await pool.connect();
  try {
    const user=req.session.user;
    let scope='',params=[];
    if (user.role==='health_worker'||user.role==='clinician') {
      scope='AND f.id IN (SELECT facility_id FROM facility_users WHERE user_id=$1 AND is_active=TRUE)';
      params=[user.id];
    } else if (user.role==='lga_officer') {
      scope='AND f.lga_id IN (SELECT lga_id FROM user_lga_access WHERE user_id=$1)';
      params=[user.id];
    } else if (!['system_admin','state_admin'].includes(user.role)) {
      return res.status(403).json({error:'You cannot view facility alerts.'});
    }
    const result=await client.query(
      `SELECT f.id AS facility_id,f.name AS facility_name,f.code AS phc_code,
              f.latitude,f.longitude,l.name AS lga_name,s.name AS state_name,
              COALESCE(latest.severity,'green') AS severity,
              latest.code AS latest_code,latest.details AS latest_details,
              latest.created_at AS latest_at
       FROM facilities f
       JOIN lgas l ON l.id=f.lga_id
       JOIN states s ON s.id=l.state_id
       LEFT JOIN LATERAL (
         SELECT code,severity,details,created_at FROM facility_alerts
         WHERE facility_id=f.id ORDER BY created_at DESC LIMIT 1
       ) latest ON TRUE
       WHERE f.is_active=TRUE AND s.name ILIKE '%Yobe%' ${scope}
       ORDER BY l.name,f.name`,params
    );
    res.json({facilities:result.rows});
  } catch(error){next(error);}
  finally{client.release();}
});

router.post('/alert', async (req,res,next) => {
  const user=req.session.user||null;
  const gatewayAuthorized=validGatewayKey(req.get('x-alert-key'));
  if(!gatewayAuthorized&&!user)return res.status(401).json({error:'Alert gateway authentication required.'});
  if(user&&!['health_worker','clinician','lga_officer','state_admin','system_admin'].includes(user.role))return res.status(403).json({error:'You cannot submit facility alerts.'});

  const code=String(req.body.code||'').trim().toUpperCase();
  const phcCode=String(req.body.phc_code||'').trim().toUpperCase();
  const details=req.body.details===undefined||req.body.details===null?'':String(req.body.details).trim();
  const source=String(req.body.source||(gatewayAuthorized?'api':'web')).toLowerCase();
  if(!ALERT_CODES[code])return res.status(400).json({error:'Unknown alert code.'});
  if(!phcCode||phcCode.length>80)return res.status(400).json({error:'A valid PHC code is required.'});
  if(details.length>1000)return res.status(400).json({error:'Alert details must be 1,000 characters or fewer.'});
  if(!['web','lora','sms','ussd','api'].includes(source))return res.status(400).json({error:'Invalid alert source.'});

  const client=await pool.connect();
  try{
    const facility=await client.query(
      `SELECT f.id,f.code FROM facilities f
       JOIN lgas l ON l.id=f.lga_id JOIN states s ON s.id=l.state_id
       WHERE f.is_active=TRUE AND s.name ILIKE '%Yobe%'
         AND (UPPER(f.code)=$1 OR UPPER('YB-'||f.code)=$1 OR UPPER(f.code)=REGEXP_REPLACE($1,'^YB-',''))
       LIMIT 1`,[phcCode]
    );
    if(!facility.rowCount)return res.status(404).json({error:'PHC code was not found in the Yobe facility register.'});
    if(user&&!gatewayAuthorized&&!(await canReadFacility(client,user,facility.rows[0].id)))return res.status(403).json({error:'You cannot submit alerts for this PHC.'});
    const created=await client.query(
      `INSERT INTO facility_alerts(facility_id,phc_code,code,severity,details,source,received_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,facility_id,phc_code,code,severity,details,source,created_at`,
      [facility.rows[0].id,phcCode,code,ALERT_CODES[code],details||null,source,user?.id||null]
    );
    res.status(201).json({alert:created.rows[0]});
  }catch(error){next(error);}
  finally{client.release();}
});

module.exports=router;

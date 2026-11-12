const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/require-auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const result = await pool.query(
      `SELECT id, full_name, email, password_hash, role, designation, can_respond_emergency, is_active
       FROM users WHERE email = $1 LIMIT 1`, [email]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await new Promise((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    req.session.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      designation: user.designation,
      canRespondEmergency: user.can_respond_emergency
    };
    res.json({ user: req.session.user });
  } catch (error) { next(error); }
});


router.post('/signup', async (req, res, next) => {
  try {
    const fullName=String(req.body.fullName||'').trim();
    const email=String(req.body.email||'').trim().toLowerCase();
    const password=String(req.body.password||'');
    if(!fullName||!email||!password) return res.status(400).json({error:'Full name, email and password are required.'});
    if(fullName.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Enter a valid name and email address.'});
    if(!/^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{8,}$/.test(password)) return res.status(400).json({error:'Password must be at least 8 characters and contain letters and numbers only.'});
    const hash=await bcrypt.hash(password,12);
    const created=await pool.query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'health_worker') RETURNING id,full_name,email,role",[fullName,email,hash]);
    await pool.query("INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id) VALUES($1,'USER_SELF_REGISTERED','user',$1)",[created.rows[0].id]);
    res.status(201).json({message:'Account created. Sign in after an administrator assigns your facility.',user:created.rows[0]});
  }catch(error){if(error.code==='23505')return res.status(409).json({error:'An account with that email already exists.'});next(error);}
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id,full_name,email,role,designation,can_respond_emergency,is_active FROM users WHERE id=$1 LIMIT 1',
      [req.session.user.id]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) {
      return req.session.destroy(() => res.status(401).json({ error: 'Account is unavailable.' }));
    }
    req.session.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      designation: user.designation,
      canRespondEmergency: user.can_respond_emergency
    };
    res.json({ user: req.session.user });
  } catch (error) { next(error); }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('phclink.sid');
    res.status(204).end();
  });
});

module.exports = router;

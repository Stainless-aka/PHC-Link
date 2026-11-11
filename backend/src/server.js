require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pool = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const facilityRoutes = require('./routes/facilities.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const referralRoutes = require('./routes/referrals.routes');
const patientRoutes = require('./routes/patients.routes');
const setupRoutes = require('./routes/setup.routes');
const adminRoutes = require('./routes/admin.routes');
const { notFound, errorHandler } = require('./middleware/error-handler');

const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required. Copy .env.example to .env and configure it.`);
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet());
app.use(cors({
  origin: (process.env.FRONTEND_ORIGIN || 'http://localhost:5500').split(',').map((value) => value.trim()),
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'phclink.sid',
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', service: 'phc-link-api' });
  } catch (error) { next(error); }
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/signup', loginLimiter);
app.use('/api/setup', setupRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/patients', patientRoutes);
app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`PHC Link API listening on port ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

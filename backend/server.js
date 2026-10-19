'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || (process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12) : '');
const DATA_FILE = path.resolve(process.env.DATA_FILE || './data.json');
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET to a random secret of at least 32 characters.'); process.exit(1);
}
if (!ADMIN_PASSWORD_HASH || !ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('Set ADMIN_PASSWORD_HASH to a bcrypt hash before starting.'); process.exit(1);
}
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin(origin, cb) {
  // Android WebView assets may send Origin: null. Restrict this list in production where possible.
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || (origin === 'null' && allowedOrigins.includes('null'))) return cb(null, true);
  return cb(new Error('Origin not allowed by CORS'));
}}));
app.use(express.json({ limit: '30kb' }));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
// Serve the companion web UI from the same HTTPS origin when deployed.
app.use(express.static(path.join(__dirname, '..', 'web')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'web', 'index.html')));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

const emptyData = () => ({ announcements: [], resources: [], contacts: [] });
function readData() {
  try { return { ...emptyData(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; }
  catch (e) { if (e.code !== 'ENOENT') console.error('Could not read data file:', e.message); return emptyData(); }
}
let data = readData();
function saveData() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = DATA_FILE + '.tmp'; fs.writeFileSync(temp, JSON.stringify(data, null, 2)); fs.renameSync(temp, DATA_FILE);
}
const clean = (v, max = 3000) => String(v ?? '').trim().slice(0, max);
const id = () => require('crypto').randomUUID();
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { req.admin = jwt.verify(token, JWT_SECRET); if (req.admin.role !== 'admin') throw new Error('role'); next(); }
  catch { return res.status(401).json({ error: 'Admin authentication required.' }); }
}
function validItem(body, fields) {
  const out = {}; for (const [field, max] of Object.entries(fields)) out[field] = clean(body[field], max);
  if (!out.title || !out.body) return { error: 'title and body are required' };
  return out;
}
app.get('/health', (_req, res) => res.json({ ok: true, service: 'HITAJE GROUPS API', time: new Date().toISOString() }));
app.get('/api/announcements', (_req, res) => res.json(data.announcements.filter(x => x.published).sort((a,b) => b.createdAt.localeCompare(a.createdAt))));
app.get('/api/resources', (_req, res) => res.json(data.resources.filter(x => x.published).sort((a,b) => b.createdAt.localeCompare(a.createdAt))));
app.post('/api/contact', (req, res) => {
  const name = clean(req.body.name, 100), email = clean(req.body.email, 254), message = clean(req.body.message, 3000);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || message.length < 5) return res.status(400).json({ error: 'Enter a name, valid email, and message (at least 5 characters).' });
  data.contacts.push({ id: id(), name, email, message, createdAt: new Date().toISOString(), status: 'new' }); saveData();
  res.status(201).json({ ok: true, message: 'Your enquiry was submitted.' });
});
app.post('/api/admin/login', rateLimit({ windowMs: 15*60*1000, limit: 8 }), async (req, res) => {
  const username = clean(req.body.username, 100), password = String(req.body.password || '');
  const ok = username === ADMIN_USERNAME && await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });
  res.json({ token: jwt.sign({ sub: username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' }), expiresIn: 28800 });
});
app.get('/api/admin/contacts', auth, (_req, res) => res.json([...data.contacts].sort((a,b) => b.createdAt.localeCompare(a.createdAt))));
// Excel-compatible CSV export of submitted contact/enquiry forms. Admin JWT required.
app.get('/api/admin/contacts.csv', auth, (_req, res) => {
  const columns = [
    ['id', 'Submission ID'], ['name', 'Name'], ['email', 'Email'],
    ['message', 'Message'], ['createdAt', 'Submitted At (UTC)'], ['status', 'Status']
  ];
  const csvCell = value => {
    let text = String(value ?? '');
    // Prevent spreadsheet formula injection when CSV is opened in Excel/Sheets.
    if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = [columns.map(([, label]) => csvCell(label)).join(',')];
  for (const contact of [...data.contacts].sort((a,b) => b.createdAt.localeCompare(a.createdAt))) {
    rows.push(columns.map(([key]) => csvCell(contact[key])).join(','));
  }
  const csv = '\uFEFF' + rows.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hitaje-form-responses.csv"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(csv);
});
for (const type of ['announcements', 'resources']) {
  app.get(`/api/admin/${type}`, auth, (_req, res) => res.json(data[type]));
  app.post(`/api/admin/${type}`, auth, (req, res) => {
    const item = validItem(req.body, { title: 180, body: 5000, url: 1000, category: 80 });
    if (item.error) return res.status(400).json({ error: item.error });
    if (item.url && !/^https:\/\//i.test(item.url)) return res.status(400).json({ error: 'URLs must use HTTPS.' });
    const record = { id: id(), ...item, published: req.body.published !== false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    data[type].push(record); saveData(); res.status(201).json(record);
  });
  app.put(`/api/admin/${type}/:id`, auth, (req, res) => {
    const record = data[type].find(x => x.id === req.params.id); if (!record) return res.status(404).json({ error: 'Not found.' });
    const item = validItem(req.body, { title: 180, body: 5000, url: 1000, category: 80 });
    if (item.error) return res.status(400).json({ error: item.error });
    if (item.url && !/^https:\/\//i.test(item.url)) return res.status(400).json({ error: 'URLs must use HTTPS.' });
    Object.assign(record, item, { published: req.body.published !== false, updatedAt: new Date().toISOString() }); saveData(); res.json(record);
  });
  app.delete(`/api/admin/${type}/:id`, auth, (req, res) => {
    const before = data[type].length; data[type] = data[type].filter(x => x.id !== req.params.id);
    if (before === data[type].length) return res.status(404).json({ error: 'Not found.' });
    saveData(); res.status(204).end();
  });
}
app.use((err, _req, res, _next) => { console.error(err.message); res.status(500).json({ error: 'Server error.' }); });
app.listen(PORT, () => console.log(`HITAJE GROUPS API listening on port ${PORT}`));

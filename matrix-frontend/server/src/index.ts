import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initializeAdmin, isAdminConfigured, createUserWithUsername } from './firebaseAdmin';

const app = express();
app.use(cors());
app.use(express.json());

// Inicializa Firebase Admin
initializeAdmin();

app.get('/health', (_req, res) => {
  res.json({ ok: true, adminConfigured: isAdminConfigured() });
});

// Middleware simples de proteção por token
function requireAdminToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const headerToken = req.headers['x-admin-token'];
  const queryToken = (req.query.token as string | undefined) || undefined;
  const provided = (Array.isArray(headerToken) ? headerToken[0] : headerToken) || queryToken;
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'server-misconfigured: missing ADMIN_API_TOKEN' });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

// POST /admin/users { username, password }
app.post('/admin/users', requireAdminToken, async (req, res) => {
  const { username, password } = (req.body || {}) as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: 'username-and-password-required' });
  }
  try {
    if (!isAdminConfigured()) return res.status(500).json({ error: 'admin-not-configured' });
    const user = await createUserWithUsername(username, password);
    return res.json({ ok: true, uid: user.uid, email: user.email });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || String(e) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on http://localhost:${PORT}`);
});

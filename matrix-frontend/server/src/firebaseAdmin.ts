import 'dotenv/config';
import admin from 'firebase-admin';

let inited = false;

export function initializeAdmin() {
  if (inited) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[firebase-admin] missing env: FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY');
    return;
  }
  // Handle escaped newlines in env
  privateKey = privateKey.replace(/\\n/g, '\n');

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    inited = true;
    console.log('[firebase-admin] initialized');
  } catch (e) {
    console.error('[firebase-admin] init error', e);
  }
}

export function isAdminConfigured() {
  return inited;
}

export async function createUserWithUsername(username: string, password: string) {
  if (!inited) throw new Error('admin-not-configured');
  const email = `${username}@private.local`;
  const user = await admin.auth().createUser({ email, password, displayName: username });
  return user;
}

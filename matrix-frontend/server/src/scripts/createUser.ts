import 'dotenv/config';
import { initializeAdmin, createUserWithUsername, isAdminConfigured } from '../firebaseAdmin';

async function main() {
  initializeAdmin();
  if (!isAdminConfigured()) {
    throw new Error('admin-not-configured: check FIREBASE_* env vars in server/.env');
  }
  const username = process.argv[2] || 'Kisame';
  const password = process.argv[3] || 'Nevoa';
  const user = await createUserWithUsername(username, password);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, uid: user.uid, email: user.email, displayName: user.displayName }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

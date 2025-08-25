import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  User,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';

let inited = false;
let configured = false;
const authGuardsBound = false;

export function initializeFirebase() {
  if (inited) return;
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  } as const;
  configured = Boolean(config.apiKey && config.authDomain && config.projectId);
  if (!configured) {
    // eslint-disable-next-line no-console
    console.warn(
      '[firebase] missing env vars: NEXT_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID',
    );
    inited = true;
    return;
  }

  const apps = getApps();
  const app = apps.length ? apps[0] : initializeApp(config as any);
  try {
    // Habilita fallback automático para long-polling em redes/proxies que quebram WebChannel/streams
    initializeFirestore(
      app as any,
      {
        experimentalAutoDetectLongPolling: true,
        useFetchStreams: false,
      } as any,
    );
    // eslint-disable-next-line no-console
    console.info('[firebase] Firestore initialized with auto long-polling');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] initializeFirestore settings failed', e);
  }
  // Auth persistence: keep user logged in across reloads/tabs (useful for tests)
  try {
    const auth = getAuth();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] failed to set browserLocalPersistence', e);
  }
  // Note: auto sign-out on tab close/offline desabilitado para não atrapalhar testes

  inited = true;
}

export function isFirebaseConfigured() {
  return configured;
}

export function onAuthChanged(cb: (u: User | null) => void) {
  if (!configured) throw new Error('Firebase not configured');
  const auth = getAuth();
  return onAuthStateChanged(auth, cb);
}

export async function authSignIn(email: string, password: string, usernameForProfile?: string) {
  if (!configured) throw new Error('Firebase not configured');
  const auth = getAuth();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  // Ensure displayName reflects username
  if (
    usernameForProfile &&
    (!cred.user.displayName || cred.user.displayName !== usernameForProfile)
  ) {
    try {
      await updateProfile(cred.user, { displayName: usernameForProfile });
    } catch {}
  }
  return cred.user;
}

export async function authSignUp(email: string, password: string, displayName?: string) {
  if (!configured) throw new Error('Firebase not configured');
  const auth = getAuth();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try {
    if (displayName) await updateProfile(cred.user, { displayName });
  } catch {}
  try {
    await sendEmailVerification(cred.user);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] sendEmailVerification failed', e);
  }
  return cred.user;
}

export async function resendEmailVerification() {
  if (!configured) throw new Error('Firebase not configured');
  const u = getAuth().currentUser;
  if (!u) throw new Error('not authenticated');
  await sendEmailVerification(u);
}

export async function reloadCurrentUser() {
  if (!configured) throw new Error('Firebase not configured');
  const u = getAuth().currentUser;
  if (!u) throw new Error('not authenticated');
  await u.reload();
  return getAuth().currentUser;
}

export async function signOutUser() {
  if (!configured) return;
  const auth = getAuth();
  await signOut(auth);
}

// --- Phone (SMS) verification helpers ---
export function setupInvisibleRecaptcha(containerId: string) {
  if (!configured) throw new Error('Firebase not configured');
  const auth = getAuth();
  const verifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  });
  return verifier;
}

export async function startPhoneLink(phoneE164: string, verifier: RecaptchaVerifier) {
  if (!configured) throw new Error('Firebase not configured');
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('not authenticated');
  const confirmation = await linkWithPhoneNumber(user, phoneE164, verifier);
  return confirmation; // has confirm(code)
}

export async function confirmPhoneCode(confirmation: any, code: string) {
  const cred = await confirmation.confirm(code);
  return cred.user;
}

// --- Admin allowlist (client-side for MVP) ---
const ADMIN_USERNAMES = (process.env.NEXT_PUBLIC_ADMIN_USERNAMES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminUser(username: string) {
  try {
    // Admin por username explícito
    if (ADMIN_USERNAMES.includes(username)) return true;
    // Admin por e-mail do usuário autenticado
    const u = getAuth().currentUser;
    const email = (u?.email || '').toLowerCase();
    if (email && ADMIN_EMAILS.includes(email)) return true;
  } catch {}
  return false;
}

// --- Chat (Firestore) ---
export type ChatMessage = {
  id?: string;
  username: string;
  text: string;
  createdAt: any;
  createdAtMs?: number;
};

export function subscribeToMessages(onMsg: (msg: ChatMessage) => void) {
  if (!configured) throw new Error('Firebase not configured');
  // Runtime guard: only authenticated users can subscribe to chat
  const u = getAuth().currentUser;
  if (!u) throw new Error('not authenticated');
  const db = getFirestore();
  const q = query(collection(db, 'messages'), orderBy('createdAt', 'asc'), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((doc) => {
        const d = doc.data() as any;
        const createdAt = d.createdAt?.toMillis?.() ?? d.createdAtMs ?? 0;
        return {
          id: doc.id,
          username: d.username,
          text: d.text,
          createdAt,
          createdAtMs: d.createdAtMs ?? createdAt,
        } as ChatMessage;
      });
      // Ordena por createdAtMs asc para estabilidade
      items.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      for (const it of items) {
        // eslint-disable-next-line no-console
        console.debug?.('[chat recv]', it.id, it.username, it.text, it.createdAtMs);
        onMsg(it);
      }
    },
    (error) => {
      // eslint-disable-next-line no-console
      console.error('[firestore onSnapshot error]', error);
    },
  );
}

export async function sendMessage(username: string, text: string) {
  if (!configured) throw new Error('Firebase not configured');
  // Runtime guard: only authenticated users can write messages
  const u = getAuth().currentUser;
  if (!u) throw new Error('not authenticated');
  const db = getFirestore();
  await addDoc(collection(db, 'messages'), {
    username,
    text,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

// Utilitário de diagnóstico: busca as N últimas mensagens (por createdAt desc)
export async function fetchRecentMessages(n = 5): Promise<ChatMessage[]> {
  if (!configured) throw new Error('Firebase not configured');
  const u = getAuth().currentUser;
  if (!u) throw new Error('not authenticated');
  const db = getFirestore();
  // Buscar por createdAtMs (sempre definido no cliente) para maior confiabilidade
  const q = query(collection(db, 'messages'), orderBy('createdAtMs', 'desc'), limit(n));
  const snap = await getDocs(q as any);
  const items: ChatMessage[] = [];
  snap.forEach((doc) => {
    const d = doc.data() as any;
    const createdAtMs = d.createdAtMs ?? d.createdAt?.toMillis?.() ?? 0;
    items.push({
      id: doc.id,
      username: d.username,
      text: d.text,
      createdAt: createdAtMs,
      createdAtMs,
    });
  });
  // retorna em ordem cronológica (asc)
  return items.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
}

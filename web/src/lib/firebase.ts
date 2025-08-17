import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID!;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!;

const firebaseConfig = { apiKey, authDomain, projectId, appId, storageBucket };

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;

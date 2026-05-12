"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

function envOrFallback(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

const firebaseConfig = {
  apiKey: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_API_KEY, "AIzaSyCbv926q3NkZU1TXF1x40XNF_Fz0so2L4s"),
  authDomain: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, "piano-roll.firebaseapp.com"),
  projectId: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "piano-roll"),
  storageBucket: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, "piano-roll.firebasestorage.app"),
  messagingSenderId: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, "197138344650"),
  appId: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_APP_ID, "1:197138344650:web:0cc066ecfeb0e186a46233"),
  measurementId: envOrFallback(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, "G-JV4G7X7ZG2"),
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { LlmUsageCost } from "./anthropic-costs";

function ensureAdminApp() {
  if (getApps().length > 0) return;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials are missing. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY on the server.",
    );
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export async function verifyFirebaseIdToken(authHeader: string | null) {
  ensureAdminApp();
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) {
    throw new Error("Sign in with Google before using the LLM.");
  }
  return getAuth().verifyIdToken(token);
}

export async function recordLlmUsage(uid: string, usage: LlmUsageCost) {
  ensureAdminApp();
  const firestore = getFirestore();
  const summaryRef = firestore.collection("users").doc(uid).collection("usage").doc("llm");
  const eventRef = summaryRef.collection("events").doc();

  await firestore.runTransaction(async (tx) => {
    tx.set(summaryRef, {
      totalCostUsd: FieldValue.increment(usage.costUsd),
      totalInputTokens: FieldValue.increment(usage.inputTokens),
      totalOutputTokens: FieldValue.increment(usage.outputTokens),
      totalCacheCreationInputTokens: FieldValue.increment(usage.cacheCreationInputTokens),
      totalCacheReadInputTokens: FieldValue.increment(usage.cacheReadInputTokens),
      lastModel: usage.model,
      lastCostUsd: usage.costUsd,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(eventRef, {
      ...usage,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

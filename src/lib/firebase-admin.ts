import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { LlmUsageCost } from "./anthropic-costs";

interface FirebaseAuthContext {
  uid: string;
  idToken: string;
  adminAvailable: boolean;
}

function firebaseProjectId(): string {
  return process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "piano-roll";
}

function firebaseWebApiKey(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || "AIzaSyCbv926q3NkZU1TXF1x40XNF_Fz0so2L4s";
}

function adminCredentials() {
  const projectId = firebaseProjectId();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function ensureAdminApp(): boolean {
  if (getApps().length > 0) return true;

  const credentials = adminCredentials();
  if (!credentials) return false;

  initializeApp({
    credential: cert(credentials),
    projectId: credentials.projectId,
  });
  return true;
}

function bearerToken(authHeader: string | null): string {
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("Sign in with Google before using the LLM.");
  return token;
}

export async function verifyFirebaseIdToken(authHeader: string | null) {
  const idToken = bearerToken(authHeader);

  if (ensureAdminApp()) {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    return { uid: decodedToken.uid, idToken, adminAvailable: true };
  }

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseWebApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.users) || !data.users[0]?.localId) {
    throw new Error(data.error?.message || "Firebase sign-in could not be verified.");
  }

  return { uid: data.users[0].localId as string, idToken, adminAvailable: false };
}

export async function recordLlmUsage(authContext: FirebaseAuthContext, usage: LlmUsageCost) {
  if (!authContext.adminAvailable) {
    await recordLlmUsageWithFirestoreRest(authContext, usage);
    return;
  }

  if (!ensureAdminApp()) {
    await recordLlmUsageWithFirestoreRest(authContext, usage);
    return;
  }

  const firestore = getFirestore();
  const summaryRef = firestore.collection("users").doc(authContext.uid).collection("usage").doc("llm");
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

function numberValue(value: number) {
  return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
}

function usageFields(usage: LlmUsageCost) {
  return {
    model: { stringValue: usage.model },
    inputTokens: numberValue(usage.inputTokens),
    outputTokens: numberValue(usage.outputTokens),
    cacheCreationInputTokens: numberValue(usage.cacheCreationInputTokens),
    cacheReadInputTokens: numberValue(usage.cacheReadInputTokens),
    costUsd: { doubleValue: usage.costUsd },
    createdAt: { timestampValue: new Date().toISOString() },
  };
}

function numericField(fields: Record<string, { integerValue?: string; doubleValue?: number }> | undefined, key: string): number {
  const field = fields?.[key];
  if (!field) return 0;
  return Number(field.integerValue ?? field.doubleValue ?? 0);
}

async function recordLlmUsageWithFirestoreRest(authContext: FirebaseAuthContext, usage: LlmUsageCost) {
  const projectId = firebaseProjectId();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const summaryPath = `users/${authContext.uid}/usage/llm`;
  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const headers = {
    Authorization: `Bearer ${authContext.idToken}`,
    "Content-Type": "application/json",
  };

  const eventRes = await fetch(`${base}/${summaryPath}/events?documentId=${eventId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields: usageFields(usage) }),
  });
  if (!eventRes.ok) {
    const data = await eventRes.json().catch(() => ({}));
    throw new Error(data.error?.message || "Could not write LLM usage event to Firestore.");
  }

  const currentRes = await fetch(`${base}/${summaryPath}`, { headers });
  if (!currentRes.ok && currentRes.status !== 404) {
    const data = await currentRes.json().catch(() => ({}));
    throw new Error(data.error?.message || "Could not read LLM usage summary from Firestore.");
  }
  const current = currentRes.ok ? await currentRes.json().catch(() => ({})) : {};
  const fields = current.fields as Record<string, { integerValue?: string; doubleValue?: number }> | undefined;

  const now = new Date().toISOString();
  const summaryRes = await fetch(`${base}/${summaryPath}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      fields: {
        totalCostUsd: { doubleValue: numericField(fields, "totalCostUsd") + usage.costUsd },
        totalInputTokens: numberValue(numericField(fields, "totalInputTokens") + usage.inputTokens),
        totalOutputTokens: numberValue(numericField(fields, "totalOutputTokens") + usage.outputTokens),
        totalCacheCreationInputTokens: numberValue(
          numericField(fields, "totalCacheCreationInputTokens") + usage.cacheCreationInputTokens,
        ),
        totalCacheReadInputTokens: numberValue(numericField(fields, "totalCacheReadInputTokens") + usage.cacheReadInputTokens),
        lastModel: { stringValue: usage.model },
        lastCostUsd: { doubleValue: usage.costUsd },
        updatedAt: { timestampValue: now },
      },
    }),
  });
  if (!summaryRes.ok) {
    const data = await summaryRes.json().catch(() => ({}));
    throw new Error(data.error?.message || "Could not write LLM usage summary to Firestore.");
  }
}

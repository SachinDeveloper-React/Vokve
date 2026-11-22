import type { app as AdminApp } from 'firebase-admin';
import { resolveServiceAccount } from '../config/serviceAccount.js';

/**
 * The one firebase-admin app this server holds, built from the `FIREBASE_*`
 * service account. Push (FCM) and phone verification share it: the SDK
 * refuses a second default app, and both are the same Firebase project the
 * phone's `google-services.json` names.
 *
 * Null when no credential is configured — a laptop or a test — and loaded
 * lazily, so the SDK is never imported where it is not used.
 */
export async function firebaseAdminApp(): Promise<{ app: AdminApp.App; projectId: string } | null> {
  const credential = resolveServiceAccount('FIREBASE');
  if (!credential) return null;

  const admin = (await import('firebase-admin')).default;
  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({ credential: admin.credential.cert(credential as never) });
  return { app, projectId: credential.project_id };
}

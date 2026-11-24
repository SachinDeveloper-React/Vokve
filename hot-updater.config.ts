/**
 * Over-the-air updates (D-111): Hot Updater on the app's own Firebase
 * project. Read by the `hot-updater` CLI only — `npx hot-updater deploy`,
 * `fingerprint create`, `console` — never by the app, which gets nothing
 * from here but the server URL and client key in `src/constants/config.ts`.
 *
 * `npx hot-updater init --provider firebase --build bare` created the
 * Firebase side (Firestore, Storage, the managed Function) on 2026-11-24 and
 * wrote `.env.hotupdater` (git-ignored: project, region, bucket, the path of
 * the service-account file). Running init again rewrites this file — put
 * this comment and `updateStrategy` back afterwards.
 *
 * `fingerprint`, not `appVersion`: an update only reaches an install whose
 * native code is the one it was built against. This app carries a lot of
 * native code (the step tracker, Health Connect, Firebase, the sign-ins), and
 * a JavaScript bundle that calls a native module the installed build does not
 * have crashes on launch. When native code changes, `fingerprint.json` is
 * created again and committed with that release, and `deploy` refuses until
 * it is.
 *
 * Node, not React Native: the app's tsconfig leaves this file out, and since
 * TypeScript 6 a file outside a tsconfig gets no `@types` on its own — hence
 * the reference below, which gives the editor `process` and `node:*`.
 */
/// <reference types="node" />
import { existsSync } from "node:fs";
import { bare } from "@hot-updater/bare";
import { firebaseDatabase, firebaseStorage } from "@hot-updater/firebase";
import { applicationDefault } from "firebase-admin/app";
import { defineConfig } from "hot-updater";
import { apiKeys, insights, remoteConfig } from "hot-updater/plugins";

if (existsSync(".env.hotupdater")) {
  process.loadEnvFile(".env.hotupdater");
}

// https://firebase.google.com/docs/admin/setup?hl=en#initialize_the_sdk_in_non-google_environments
// Reuse working application-default credentials (ADC).
// Only when a credential file is needed, set its private local path in .env.hotupdater:
// GOOGLE_APPLICATION_CREDENTIALS=./firebase-adminsdk-credentials.json
const credential = applicationDefault();

export default defineConfig({
  build: bare({ enableHermes: true }),
  storage: firebaseStorage({
    projectId: process.env.HOT_UPDATER_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.HOT_UPDATER_FIREBASE_STORAGE_BUCKET!,
    credential,
  }),
  database: firebaseDatabase({
    projectId: process.env.HOT_UPDATER_FIREBASE_PROJECT_ID!,
    databaseId: process.env.HOT_UPDATER_FIREBASE_DATABASE_ID,
    credential,
  }),
  plugins: [apiKeys(), insights(), remoteConfig()],
  updateStrategy: "fingerprint",
});

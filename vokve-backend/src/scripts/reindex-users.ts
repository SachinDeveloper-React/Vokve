import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { UserModel } from '../modules/identity/models.js';

/**
 * Rebuilds the `users` indexes that Google sign-in changed (RULES O12).
 *
 *   npm run users:reindex
 *
 * Mongoose creates an index it does not find. It will not *alter* one it
 * does: a definition that changed in the code leaves the old index in
 * place on a database that has been running, silently, with no warning
 * anywhere. Two of them changed.
 *
 *  - **`phone`** was uniquely indexed and is now uniquely *sparse*
 *    indexed. An account that arrived through Google has no phone, and
 *    under the old index every one of them is the same missing value —
 *    so the first Google member signs in and the second is refused with
 *    a duplicate key error naming a field they were never asked for.
 *
 *  - **`googleId`** is new, unique and sparse.
 *
 * Safe to run more than once, and safe to run before anybody has signed
 * in with Google — it drops nothing that is not being replaced, and
 * `syncIndexes` builds exactly what the schema now says.
 *
 * Run it **before** the build that offers the Google button reaches
 * anybody. Afterwards is still a fix, but the people who hit it first
 * will have been told their account could not be created.
 */
async function main(): Promise<void> {
  await connectMongo();
  try {
    const before = await UserModel.collection.indexes();
    const phone = before.find(index => index.name === 'phone_1');
    console.log(`phone index before: ${phone ? JSON.stringify(phone) : 'none'}`);

    // `syncIndexes` drops indexes the schema no longer declares and
    // creates the ones it does — which, for a definition that merely
    // changed, means the old one goes and the new one is built.
    const dropped = await UserModel.syncIndexes();
    console.log(`dropped: ${JSON.stringify(dropped)}`);

    const after = await UserModel.collection.indexes();
    for (const index of after) {
      console.log(`  ${index.name}: ${JSON.stringify(index.key)}${index.sparse ? ' (sparse)' : ''}${index.unique ? ' (unique)' : ''}`);
    }
  } finally {
    await disconnectMongo();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

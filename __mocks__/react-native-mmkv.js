/**
 * react-native-mmkv ships its own Jest mock, but `getMMKVFactory` eagerly
 * imports react-native-nitro-modules, which calls TurboModuleRegistry
 * .getEnforcing('NitroModules') at module scope and throws outside a native
 * build. Replacing the module with an in-memory store keeps tests native-free.
 */

const createInstance = () => {
  const store = new Map();

  return {
    set: (key, value) => store.set(key, value),
    getString: key => (store.has(key) ? String(store.get(key)) : undefined),
    getNumber: key => (store.has(key) ? Number(store.get(key)) : undefined),
    getBoolean: key => (store.has(key) ? Boolean(store.get(key)) : undefined),
    contains: key => store.has(key),
    remove: key => store.delete(key),
    getAllKeys: () => Array.from(store.keys()),
    clearAll: () => store.clear(),
    addOnValueChangedListener: () => ({ remove: () => {} }),
  };
};

exports.createMMKV = createInstance;
exports.existsMMKV = () => false;
exports.deleteMMKV = () => {};

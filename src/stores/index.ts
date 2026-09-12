import { createMMKV, type MMKV } from 'react-native-mmkv';

let instance: MMKV | null = null;

/**
 * The MMKV instance is built on first use rather than at module scope.
 * Creating it eagerly makes merely *importing* this file initialise a native
 * module, so anything that transitively imports a store — the theme, a
 * navigator, a screen — would crash the app during startup on a build where
 * the native side is missing. Deferring it turns that into an ordinary
 * exception at the call site, where it can be caught.
 */
export function getMMKV(): MMKV {
  if (instance == null) {
    instance = createMMKV({ id: 'vokve.storage' });
  }
  return instance;
}

/** Matches zustand's `StateStorage`, so it can back `persist` directly. */
export const mmkvStorage = {
  setItem: (name: string, value: string) => {
    getMMKV().set(name, value);
  },
  getItem: (name: string) => {
    return getMMKV().getString(name) ?? null;
  },
  removeItem: (name: string) => {
    getMMKV().remove(name);
  },
};

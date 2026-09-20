import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './index';

/** How many past searches the search screen offers back. */
const MAX_RECENT = 8;

interface ShopSearchState {
  /** Newest first, de-duplicated, case-folded. */
  recent: string[];
  remember: (query: string) => void;
  forget: (query: string) => void;
  clear: () => void;
}

/**
 * What the user has searched the shop for before — a convenience that lives
 * on the device and nowhere else. It is not sent anywhere: the server sees
 * each search as it happens and needs no list of them.
 */
export const useShopSearchStore = create<ShopSearchState>()(
  persist(
    set => ({
      recent: [],

      remember: query => {
        const term = query.trim();
        if (term.length < 2) {
          return;
        }
        set(state => ({
          recent: [
            term,
            ...state.recent.filter(
              entry => entry.toLowerCase() !== term.toLowerCase(),
            ),
          ].slice(0, MAX_RECENT),
        }));
      },

      forget: query =>
        set(state => ({
          recent: state.recent.filter(entry => entry !== query),
        })),

      clear: () => set({ recent: [] }),
    }),
    {
      name: 'vokve.shopSearch',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

export const useRecentShopSearches = () => useShopSearchStore(s => s.recent);

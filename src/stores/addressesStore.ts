import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { addressApi } from '../services/api/endpoints';
import type { AddressInput } from '../services/api/contracts';
import { toApiError } from '../services/api/errors';
import type { Address, DeliveryPreferences } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

interface AddressesState {
  /** Default first, then newest — the order the server lists them in. */
  addresses: Address[];
  /** When the server last confirmed the list; null until the first sync. */
  syncedAt: string | null;
  isSyncing: boolean;
  /** Set while a create / update / delete is in flight. */
  isSaving: boolean;
  /**
   * How the member likes orders handed over (RULES R17) — what the shipping
   * page opens with. Null until the server has said.
   */
  delivery: DeliveryPreferences | null;

  hydrateFromServer: () => Promise<void>;
  hydrateDelivery: () => Promise<void>;
  /**
   * Saves the preferences and takes the server's answer back — the note
   * trimmed, WhatsApp off where it is not offered. Throws the `ApiError`.
   */
  saveDelivery: (
    patch: Partial<DeliveryPreferences>,
  ) => Promise<DeliveryPreferences>;
  /**
   * Each write goes to the server first and the list is replaced from the
   * answer: an address is a thing the courier reads, so an optimistic copy
   * the server then corrected — a trimmed PIN, a defaulted country — would
   * be the one the user checked and the wrong one.
   */
  create: (input: AddressInput) => Promise<Address | null>;
  update: (id: string, patch: Partial<AddressInput>) => Promise<Address | null>;
  setDefault: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  reset: () => void;
}

/**
 * The shipping address book (RULES R4).
 *
 * A cache of `GET /me/addresses`, hydrated when the book is opened and after
 * every write. Persisted so the checkout can offer the default address the
 * moment it opens, before the network answers.
 */
export const useAddressesStore = create<AddressesState>()(
  persist(
    (set, get) => ({
      addresses: [],
      syncedAt: null,
      isSyncing: false,
      isSaving: false,
      delivery: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const addresses = await addressApi.list();
          set({
            addresses,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
          });
        } catch (error) {
          logger.warn(
            'addressesStore',
            'Address sync failed',
            toApiError(error),
          );
          set({ isSyncing: false });
        }
      },

      hydrateDelivery: async () => {
        try {
          set({ delivery: await addressApi.deliveryPreferences() });
        } catch (error) {
          logger.warn(
            'addressesStore',
            'Delivery preferences sync failed',
            toApiError(error),
          );
        }
      },

      saveDelivery: async patch => {
        try {
          const delivery = await addressApi.setDeliveryPreferences(patch);
          set({ delivery });
          return delivery;
        } catch (error) {
          throw toApiError(error);
        }
      },

      create: async input => {
        set({ isSaving: true });
        try {
          const created = await addressApi.create(input);
          await get().hydrateFromServer();
          set({ isSaving: false });
          return created;
        } catch (error) {
          logger.warn(
            'addressesStore',
            'Could not save address',
            toApiError(error),
          );
          set({ isSaving: false });
          throw toApiError(error);
        }
      },

      update: async (id, patch) => {
        set({ isSaving: true });
        try {
          const updated = await addressApi.update(id, patch);
          await get().hydrateFromServer();
          set({ isSaving: false });
          return updated;
        } catch (error) {
          set({ isSaving: false });
          throw toApiError(error);
        }
      },

      setDefault: async id => {
        set({ isSaving: true });
        try {
          await addressApi.setDefault(id);
          await get().hydrateFromServer();
          set({ isSaving: false });
          return true;
        } catch (error) {
          logger.warn(
            'addressesStore',
            'Could not set default',
            toApiError(error),
          );
          set({ isSaving: false });
          return false;
        }
      },

      remove: async id => {
        set({ isSaving: true });
        try {
          await addressApi.remove(id);
          await get().hydrateFromServer();
          set({ isSaving: false });
          return true;
        } catch (error) {
          logger.warn(
            'addressesStore',
            'Could not delete address',
            toApiError(error),
          );
          set({ isSaving: false });
          return false;
        }
      },

      reset: () =>
        set({
          addresses: [],
          syncedAt: null,
          isSyncing: false,
          isSaving: false,
          delivery: null,
        }),
    }),
    {
      name: 'vokve.addresses',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({
        addresses: state.addresses,
        syncedAt: state.syncedAt,
        delivery: state.delivery,
      }),
    },
  ),
);

export const useAddresses = () => useAddressesStore(s => s.addresses);
export const useDefaultAddress = () =>
  useAddressesStore(
    s => s.addresses.find(a => a.isDefault) ?? s.addresses[0] ?? null,
  );
export const useIsSavingAddress = () => useAddressesStore(s => s.isSaving);

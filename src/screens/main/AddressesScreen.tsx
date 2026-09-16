import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Plus, Trash2 } from 'lucide-react-native';
import { AddressCard } from '../../components/address/AddressCard';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { useToast } from '../../components/feedback/Toast';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useAuthStatus } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useAddresses, useAddressesStore } from '../../stores/addressesStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    empty: { paddingVertical: spacing.xl },
  });

/**
 * The address book (RULES R4), in two moods.
 *
 * Opened from an order or the account it manages: default, edit, delete.
 * Opened from a checkout (`select`) it chooses: tapping an address makes it
 * the default and goes straight back, which is how the checkout learns the
 * answer — it reads the default — without the choice riding through a route
 * param that would be stale by the next visit.
 */
export const AddressesScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'Addresses'>['route']>();
  const toast = useToast();
  const selecting = route.params?.select === true;

  const balance = useCoinBalance();
  const addresses = useAddresses();
  const isSyncing = useAddressesStore(s => s.isSyncing);
  const isSaving = useAddressesStore(s => s.isSaving);
  const syncedAt = useAddressesStore(s => s.syncedAt);
  const hydrateFromServer = useAddressesStore(s => s.hydrateFromServer);
  const setDefault = useAddressesStore(s => s.setDefault);
  const remove = useAddressesStore(s => s.remove);
  const isSignedIn = useAuthStatus() === 'authenticated';

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (isSignedIn) {
      hydrateFromServer();
    }
  }, [hydrateFromServer, isSignedIn]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Orders');
  }, [navigation]);

  const addAddress = useCallback(
    () => navigation.navigate('AddressForm'),
    [navigation],
  );
  const editAddress = useCallback(
    (id: string) => navigation.navigate('AddressForm', { id }),
    [navigation],
  );

  const makeDefault = useCallback(
    async (id: string) => {
      setBusyId(id);
      const ok = await setDefault(id);
      setBusyId(null);
      if (!ok) {
        toast.show({
          title: "Couldn't update",
          message: 'Check your connection and try again.',
          tone: 'warning',
        });
      }
      return ok;
    },
    [setDefault, toast],
  );

  // Selecting is making it the default and leaving; the checkout under this
  // screen reads the default the moment it is back on top.
  const select = useCallback(
    async (id: string) => {
      const ok = await makeDefault(id);
      if (ok) {
        onPressBack();
      }
    },
    [makeDefault, onPressBack],
  );

  const askDelete = useCallback((id: string) => setDeletingId(id), []);
  const closeDelete = useCallback(() => setDeletingId(null), []);
  const confirmDelete = useCallback(async () => {
    const id = deletingId;
    if (!id) {
      return;
    }
    setBusyId(id);
    const ok = await remove(id);
    setBusyId(null);
    toast.show(
      ok
        ? { title: 'Address removed', tone: 'success' }
        : {
            title: "Couldn't remove",
            message: 'Check your connection and try again.',
            tone: 'warning',
          },
    );
  }, [deletingId, remove, toast]);

  const deleteActions = useMemo(
    () => [
      {
        label: 'Remove this address',
        icon: Trash2,
        destructive: true,
        onPress: confirmDelete,
      },
    ],
    [confirmDelete],
  );

  const deleting = addresses.find(a => a.id === deletingId) ?? null;

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing && syncedAt !== null}
            onRefresh={hydrateFromServer}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title={selecting ? 'Deliver to' : 'Addresses'}
          subtitle={
            selecting
              ? 'Choose where this reward goes'
              : 'Where your rewards are sent'
          }
        />

        {addresses.length === 0 ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="No addresses yet"
              message="Add the address your rewards should be posted to. You can keep more than one."
              actionLabel="Add an address"
              onAction={addAddress}
            />
          </Card>
        ) : (
          <>
            {addresses.map(address => (
              <AddressCard
                key={address.id}
                address={address}
                mode={selecting ? 'select' : 'manage'}
                busy={isSaving && busyId === address.id}
                onSelect={select}
                onEdit={editAddress}
                onSetDefault={makeDefault}
                onDelete={askDelete}
              />
            ))}
            <Button
              label="Add another address"
              variant="secondary"
              fullWidth
              icon={<Plus size={18} color={colors.text} />}
              onPress={addAddress}
            />
          </>
        )}
      </ScrollView>

      <ActionSheet
        visible={deletingId !== null}
        onClose={closeDelete}
        title={deleting ? `Remove ${deleting.label}?` : 'Remove address?'}
        message={
          deleting?.isDefault
            ? 'This is your default. Another address will take its place.'
            : 'Orders already placed keep the address they were sent to.'
        }
        actions={deleteActions}
        cancelLabel="Keep it"
      />
    </Screen>
  );
};

import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useToast } from '../../components/feedback/Toast';
import { FormInput, FormSwitch } from '../../components/form/fields';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { toApiError } from '../../services/api/errors';
import { useCurrentUser } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useAddressesStore } from '../../stores/addressesStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { addressFormSchema, type AddressFormValues } from '../../types/forms';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    half: { flex: 1 },
  });

/**
 * Adds or edits one shipping address (RULES R4).
 *
 * One form for both: the only difference is what the fields start with,
 * and a second screen for editing would be this one with the values filled
 * in. A new address on an empty book is made the default by the server
 * whatever the switch says, so the switch is only shown once there is a
 * choice to make.
 */
export const AddressFormScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'AddressForm'>['route']>();
  const toast = useToast();
  const user = useCurrentUser();
  const balance = useCoinBalance();

  const addresses = useAddressesStore(s => s.addresses);
  const isSaving = useAddressesStore(s => s.isSaving);
  const create = useAddressesStore(s => s.create);
  const update = useAddressesStore(s => s.update);

  const editing = useMemo(
    () => addresses.find(a => a.id === route.params?.id) ?? null,
    [addresses, route.params?.id],
  );
  const hasOthers = addresses.some(a => a.id !== editing?.id);

  const { control, handleSubmit, setError } = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    // The recipient defaults to the account holder: that is who it is nine
    // times out of ten, and the tenth can type over it.
    defaultValues: editing
      ? {
          label: editing.label,
          name: editing.name,
          phone: editing.phone,
          line1: editing.line1,
          line2: editing.line2,
          city: editing.city,
          state: editing.state,
          postalCode: editing.postalCode,
          isDefault: editing.isDefault,
        }
      : {
          label: addresses.length === 0 ? 'Home' : '',
          name: user?.name ?? '',
          phone: user?.phone ?? '',
          line1: '',
          line2: '',
          city: '',
          state: '',
          postalCode: '',
          isDefault: addresses.length === 0,
        },
  });

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Addresses');
  }, [navigation]);

  const onSubmit = useCallback(
    async (values: AddressFormValues) => {
      try {
        if (editing) {
          await update(editing.id, { ...values, country: editing.country });
        } else {
          await create({ ...values, country: 'IN' });
        }
        toast.show({
          title: editing ? 'Address updated' : 'Address added',
          tone: 'success',
        });
        onPressBack();
      } catch (error) {
        const apiError = toApiError(error);
        // Field messages from a 422 land on their fields; anything else is
        // told once, at the top, in the server's words.
        const fields = apiError.fieldErrors;
        const known = Object.keys(fields) as (keyof AddressFormValues)[];
        known.forEach(field => setError(field, { message: fields[field] }));
        if (known.length === 0) {
          toast.show({
            title: "Couldn't save",
            message: apiError.message,
            tone: 'error',
          });
        }
      }
    },
    [create, editing, onPressBack, setError, toast, update],
  );

  const submit = useCallback(() => {
    handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title={editing ? 'Edit address' : 'New address'}
          subtitle="Where should we send your rewards?"
        />

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <FormInput
              control={control}
              name="label"
              label="Save as"
              placeholder="Home, Office…"
              accessibilityLabel="Address label"
              autoCapitalize="words"
            />
            <FormInput
              control={control}
              name="name"
              label="Recipient"
              placeholder="Full name"
              accessibilityLabel="Recipient name"
              autoCapitalize="words"
              textContentType="name"
            />
            <FormInput
              control={control}
              name="phone"
              label="Phone"
              placeholder="+91 98765 43210"
              accessibilityLabel="Phone number for the courier"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
            />
            <FormInput
              control={control}
              name="line1"
              label="Address"
              placeholder="House, street"
              accessibilityLabel="Address line 1"
              textContentType="streetAddressLine1"
            />
            <FormInput
              control={control}
              name="line2"
              placeholder="Area, landmark (optional)"
              accessibilityLabel="Address line 2"
              textContentType="streetAddressLine2"
            />
            <HStack gap="sm" align="start">
              <FormInput
                control={control}
                name="city"
                label="City"
                placeholder="City"
                accessibilityLabel="City"
                autoCapitalize="words"
                textContentType="addressCity"
                style={styles.half}
              />
              <FormInput
                control={control}
                name="postalCode"
                label="PIN code"
                placeholder="560001"
                accessibilityLabel="PIN code"
                keyboardType="number-pad"
                maxLength={6}
                textContentType="postalCode"
                style={styles.half}
              />
            </HStack>
            <FormInput
              control={control}
              name="state"
              label="State"
              placeholder="State"
              accessibilityLabel="State"
              autoCapitalize="words"
              textContentType="addressState"
            />
            {hasOthers ? (
              <FormSwitch
                control={control}
                name="isDefault"
                label="Use as my default address"
                helper="Rewards ship here unless you choose another at checkout."
              />
            ) : null}
          </VStack>
        </Card>

        <Button
          label={editing ? 'Save changes' : 'Save address'}
          variant="brand"
          size="lg"
          fullWidth
          loading={isSaving}
          disabled={isSaving}
          onPress={submit}
        />
      </KeyboardAwareScrollView>
    </Screen>
  );
};

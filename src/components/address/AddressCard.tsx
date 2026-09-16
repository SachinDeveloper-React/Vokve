import React, { memo, useCallback } from 'react';
import { MapPin } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { Address } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { Tag } from '../ui/Tag';
import { Pressable } from '../form/Pressable';

/** The address on three lines, the way a courier label reads it. */
export function formatAddressLines(
  address: Omit<Address, 'id' | 'isDefault'>,
): string[] {
  return [
    [address.line1, address.line2].filter(Boolean).join(', '),
    `${address.city}, ${address.state} ${address.postalCode}`,
    address.phone,
  ];
}

interface Props {
  address: Address;
  /**
   * `'select'` offers one action — use this address — for a checkout;
   * `'manage'` offers the book's own: make default, edit, delete.
   */
  mode: 'select' | 'manage';
  /** Set while this address is the one being written to the server. */
  busy?: boolean;
  onSelect?: (id: string) => void;
  onEdit?: (id: string) => void;
  onSetDefault?: (id: string) => void;
  onDelete?: (id: string) => void;
}

/**
 * One entry in the address book.
 *
 * The default is marked with a tag rather than moved to its own section: a
 * book of two or three addresses does not need a heading to find the first,
 * and a section that emptied when the default was deleted would leave a gap
 * where the eye expects the answer.
 */
export const AddressCard = memo(
  ({
    address,
    mode,
    busy = false,
    onSelect,
    onEdit,
    onSetDefault,
    onDelete,
  }: Props) => {
    const { colors } = useTheme();
    const select = useCallback(
      () => onSelect?.(address.id),
      [address.id, onSelect],
    );
    const edit = useCallback(() => onEdit?.(address.id), [address.id, onEdit]);
    const setDefault = useCallback(
      () => onSetDefault?.(address.id),
      [address.id, onSetDefault],
    );
    const remove = useCallback(
      () => onDelete?.(address.id),
      [address.id, onDelete],
    );
    const lines = formatAddressLines(address);

    const body = (
      <VStack gap="sm">
        <HStack align="start" gap="md">
          <IconBadge
            icon={MapPin}
            tint={colors.primary}
            size={32}
            variant="muted"
          />
          <VStack flex={1} gap="xxs">
            <HStack align="center" gap="sm" wrap>
              <AppText variant="bodyStrong">{address.label}</AppText>
              {address.isDefault ? (
                <Tag label="Default" tint={colors.success} />
              ) : null}
            </HStack>
            <AppText variant="body">{address.name}</AppText>
            {lines.map(line => (
              <AppText key={line} variant="caption" color="textSecondary">
                {line}
              </AppText>
            ))}
          </VStack>
        </HStack>

        {mode === 'manage' ? (
          <HStack align="center" gap="sm" wrap>
            {!address.isDefault ? (
              <Button
                label="Make default"
                variant="secondary"
                size="xs"
                loading={busy}
                disabled={busy}
                onPress={setDefault}
              />
            ) : null}
            <Button
              label="Edit"
              variant="ghost"
              size="xs"
              disabled={busy}
              onPress={edit}
            />
            <Button
              label="Delete"
              variant="ghost"
              size="xs"
              disabled={busy}
              onPress={remove}
            />
          </HStack>
        ) : (
          <Button
            label={address.isDefault ? 'Delivering here' : 'Deliver here'}
            variant={address.isDefault ? 'secondary' : 'brand'}
            size="sm"
            loading={busy}
            disabled={busy || address.isDefault}
            onPress={select}
          />
        )}
      </VStack>
    );

    if (mode === 'select') {
      return (
        <Pressable
          onPress={select}
          feedback="scale"
          disabled={busy || address.isDefault}
          accessibilityRole="button"
          accessibilityLabel={`Deliver to ${address.label}, ${address.name}`}
        >
          <Card radius="xl" padding="base">
            {body}
          </Card>
        </Pressable>
      );
    }
    return (
      <Card radius="xl" padding="base">
        {body}
      </Card>
    );
  },
);

AddressCard.displayName = 'AddressCard';

import React, { memo, useCallback } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { Copy } from 'lucide-react-native';
import { useToast } from '../feedback/Toast';
import { useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The reference a member reads out to support — `VOK2509191234`. */
  number: string;
  /** `inline` is the list's one line; `stacked` is the order page's heading. */
  layout?: 'inline' | 'stacked';
}

/**
 * The order's reference, with the one thing anybody wants to do with it:
 * copy it.
 *
 * A member on the phone to support, or pasting it into a message, should
 * not have to retype twelve characters from a screenshot — and selecting
 * text inside a row that is itself a link to the order is a fight. The
 * tap target is the number and the glyph together.
 */
export const OrderNumberRow = memo(({ number, layout = 'inline' }: Props) => {
  const { colors } = useTheme();
  const toast = useToast();

  const copy = useCallback(() => {
    Clipboard.setString(number);
    toast.show({
      title: 'Order ID copied',
      message: `${number} is on your clipboard.`,
      tone: 'success',
    });
  }, [number, toast]);

  return (
    <Pressable
      onPress={copy}
      feedback="opacity"
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Order ID ${number}, copy`}
    >
      <HStack align="center" gap="xs">
        {layout === 'inline' ? (
          <AppText variant="micro" color="textSecondary">
            Order ID
          </AppText>
        ) : null}
        <AppText variant={layout === 'inline' ? 'bodyStrong' : 'h2'}>
          {number}
        </AppText>
        <Icon
          as={Copy}
          size={layout === 'inline' ? 'xs' : 'sm'}
          tint={colors.textTertiary}
        />
      </HStack>
    </Pressable>
  );
});

OrderNumberRow.displayName = 'OrderNumberRow';

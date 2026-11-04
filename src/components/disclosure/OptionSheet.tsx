import React, { memo, useCallback } from 'react';
import { moderateScale } from '../../theme/responsive';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import {
  BottomSheet,
  BottomSheetScrollView,
  useSheetBodyMaxHeight,
} from './BottomSheet';
import { OptionRow, type SheetOption } from './OptionRow';

export type { SheetOption } from './OptionRow';

/** What the cancel button is kept out of the scrolling body for. */
const BUTTONS_HEIGHT = moderateScale(72);

interface Props<T extends string> {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** A line under the title, for what the whole choice affects. */
  message?: string;
  options: SheetOption<T>[];
  /** The choice in force, which the sheet opens showing. */
  value: T | null;
  onSelect: (value: T) => void;
  cancelLabel?: string;
}

/**
 * A single choice in a bottom sheet, with the current one marked.
 *
 * Separate from `ActionSheet` rather than a flag on it: an action sheet is a
 * menu of things to *do*, where nothing is ever "on", and a picker is a
 * statement of what is currently set. They want different rows — a picker's
 * has to carry a mark, and usually a word about what the option means — and
 * folding both into one component is how a picker ends up with the current
 * choice shown as a disabled row, which reads as "unavailable" rather than
 * "this is the one you are on".
 *
 * Choosing closes the sheet before the handler runs, for the same reason the
 * action sheet does it: a handler that navigates would otherwise leave the
 * sheet stranded over the next screen.
 */
function OptionSheetInner<T extends string>({
  visible,
  onClose,
  title,
  message,
  options,
  value,
  onSelect,
  cancelLabel = 'Cancel',
}: Props<T>) {
  const maxBody = useSheetBodyMaxHeight(BUTTONS_HEIGHT);

  const select = useCallback(
    (picked: T) => {
      onClose();
      onSelect(picked);
    },
    [onClose, onSelect],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <VStack gap="base" pb="xs">
        {message ? (
          <AppText variant="caption" color="textSecondary">
            {message}
          </AppText>
        ) : null}

        <BottomSheetScrollView
          style={{ maxHeight: maxBody }}
          showsVerticalScrollIndicator={false}
        >
          <VStack gap="sm" accessibilityRole="radiogroup">
            {options.map(option => (
              <OptionRow
                key={option.value}
                option={option}
                selected={option.value === value}
                onSelect={select}
              />
            ))}
          </VStack>
        </BottomSheetScrollView>

        <Button
          label={cancelLabel}
          variant="secondary"
          fullWidth
          onPress={onClose}
          accessibilityLabel={cancelLabel}
        />
      </VStack>
    </BottomSheet>
  );
}

export const OptionSheet = memo(OptionSheetInner) as typeof OptionSheetInner;

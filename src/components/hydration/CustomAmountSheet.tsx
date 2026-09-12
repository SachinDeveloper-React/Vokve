import React, { memo, useCallback, useState } from 'react';
import { BottomSheet } from '../disclosure/BottomSheet';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Input } from '../form/Input';

/** What a glass and a large bottle bracket; anything outside is a typo. */
const MIN_ML = 10;
const MAX_ML = 3000;

interface Props {
  visible: boolean;
  onSubmit: (ml: number) => void;
  onClose: () => void;
}

/**
 * A sheet for an amount the five tiles do not carry.
 *
 * Typed rather than picked from a wheel: the tiles already cover every round
 * amount worth scrolling to, so what is left is the odd bottle size somebody
 * knows the number for — 330, 750, 1250 — which is faster to type than to
 * spin past.
 *
 * The draft is held here and only handed over on Add: committing on every
 * keystroke would log 1, then 12, then 125 on the way to 1250.
 */
export const CustomAmountSheet = memo(
  ({ visible, onSubmit, onClose }: Props) => {
    const [draft, setDraft] = useState('');

    const amount = Number.parseInt(draft, 10);
    const isValid =
      Number.isFinite(amount) && amount >= MIN_ML && amount <= MAX_ML;

    const handleChange = useCallback(
      // Digits only: the keyboard offers a decimal point on some locales, and
      // half a millilitre is not a thing anyone means to log.
      (value: string) => setDraft(value.replace(/[^0-9]/g, '').slice(0, 4)),
      [],
    );

    const handleClose = useCallback(() => {
      setDraft('');
      onClose();
    }, [onClose]);

    const handleSubmit = useCallback(() => {
      if (!isValid) {
        return;
      }
      onSubmit(amount);
      setDraft('');
      onClose();
    }, [amount, isValid, onClose, onSubmit]);

    return (
      <BottomSheet visible={visible} onClose={handleClose} title="Custom amount">
        <VStack gap="base" pb="base">
          <Input
            label="Amount"
            value={draft}
            onChangeText={handleChange}
            keyboardType="number-pad"
            placeholder="e.g. 330"
            helper={`Between ${MIN_ML} and ${MAX_ML} ml`}
            trailing={
              <AppText variant="caption" color="textSecondary">
                ml
              </AppText>
            }
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <Button
            label="Add water"
            size="lg"
            fullWidth
            disabled={!isValid}
            onPress={handleSubmit}
          />
        </VStack>
      </BottomSheet>
    );
  },
);

CustomAmountSheet.displayName = 'CustomAmountSheet';

import React, { memo, useMemo } from 'react';
import { ActionSheet } from '../disclosure/ActionSheet';
import type { LogWater } from '../../hooks/useLogWater';

interface Props {
  guard: LogWater;
}

/**
 * The question `useLogWater` raises about an unusual drink (RULES Y1b).
 *
 * A component rather than the sheet being written out on each screen, so the
 * dashboard and the water screen cannot word the same question two different
 * ways — or, worse, one of them forget to draw it and silently log a drink
 * the guard meant to ask about.
 *
 * The confirming action is labelled "Log water" rather than "OK": the reader
 * is one tap from a thing happening, and the button should say what that
 * thing is.
 */
export const WaterGuardSheet = memo(({ guard }: Props) => {
  const actions = useMemo(
    () => [{ label: 'Log water', onPress: guard.confirm }],
    [guard.confirm],
  );

  return (
    <ActionSheet
      visible={guard.question !== null}
      onClose={guard.dismiss}
      title={guard.question?.title}
      message={guard.question?.message}
      actions={actions}
      cancelLabel="Cancel"
    />
  );
});

WaterGuardSheet.displayName = 'WaterGuardSheet';

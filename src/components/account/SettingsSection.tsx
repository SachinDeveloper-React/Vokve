import React, { memo } from 'react';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  /** Upper-cased by the `label` type variant — write it in sentence case. */
  title: string;
  children: React.ReactNode;
}

/**
 * A titled block of settings.
 *
 * One card per group rather than one long card with rules between the groups:
 * the gap between cards is what tells the eye where a group ends, and it
 * survives a group growing from one control to four.
 */
export const SettingsSection = memo(({ title, children }: Props) => (
  <Card radius="xl">
    <VStack gap="md">
      <AppText variant="label" color="textTertiary">
        {title}
      </AppText>
      {children}
    </VStack>
  </Card>
));

SettingsSection.displayName = 'SettingsSection';

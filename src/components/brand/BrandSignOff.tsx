import React, { memo } from 'react';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Wordmark } from './Wordmark';

/** The wordmark and its line, centred — how a page that ends on the brand ends. */
export const BrandSignOff = memo(() => (
  <VStack align="center" gap="xxs">
    <Wordmark size="sm" />
    <AppText variant="caption" color="textSecondary" center>
      Move More. Live Better.
    </AppText>
  </VStack>
));

BrandSignOff.displayName = 'BrandSignOff';

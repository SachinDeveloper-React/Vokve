import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Sun } from 'lucide-react-native';
import { fontWeight, useTheme } from '../../theme';
import type { StepGoal } from '../../types/models';
import { formatGrouped } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { recommendationBasis } from './goalScale';

interface Props {
  recommended: number;
  basedOn: StepGoal['basedOn'];
}

/**
 * Why that figure: what the server worked the suggestion out from, naming
 * only what it had — a profile with no date of birth is not told its age
 * was used.
 */
export const StepGoalAdviceCard = memo(({ recommended, basedOn }: Props) => {
  const { colors } = useTheme();

  return (
    <Box bg="card" radius="lg" p="base">
      <HStack align="center" gap="md">
        <Icon as={Sun} size="lg" tint={colors.brandAccent} />
        <AppText variant="caption" color="textSecondary" style={styles.text}>
          {`${recommendationBasis(basedOn)} we recommend `}
          <AppText
            variant="caption"
            style={[styles.figure, { color: colors.brandAccent }]}
          >
            {`${formatGrouped(recommended)} steps per day.`}
          </AppText>
        </AppText>
      </HStack>
    </Box>
  );
});

StepGoalAdviceCard.displayName = 'StepGoalAdviceCard';

const styles = StyleSheet.create({
  text: { flex: 1 },
  figure: { fontWeight: fontWeight.bold },
});

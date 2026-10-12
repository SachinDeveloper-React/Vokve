import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';

const DISC = moderateScale(40);

interface Props {
  /** The plan the day on screen came out of. */
  planName: string;
  /** Which day of it this is, and how many it runs. */
  dayNumber: number;
  cycleLength: number;
  /** True where the user picked this plan rather than the server choosing it. */
  chosenByUser: boolean;
  /** What the server would choose by — "Vegetarian · Balanced". */
  basis: string;
  onPressChange: () => void;
}

/**
 * Which plan the day on screen came from, and the way to a different one.
 *
 * It says whose choice the plan was, because the two cases need different
 * things said. A plan the user picked is theirs to change; a plan the server
 * chose is a consequence of their preferences, and a user who does not know
 * that will go looking for a setting that does not exist.
 */
export const CurrentPlanCard = memo(
  ({
    planName,
    dayNumber,
    cycleLength,
    chosenByUser,
    basis,
    onPressChange,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="sm">
          <HStack align="center" gap="md">
            <Box
              radius="pill"
              style={[styles.disc, { backgroundColor: colors.muted }]}
            >
              <Icon as={Sparkles} size="sm" color="primary" />
            </Box>

            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong" numberOfLines={1}>
                {planName}
              </AppText>
              <AppText variant="miniMicro" color="textSecondary">
                {chosenByUser
                  ? 'Your plan'
                  : `Chosen for you from ${basis}`}
              </AppText>
            </VStack>

            <Chip label={`Day ${dayNumber} of ${cycleLength}`} />
          </HStack>

          <Button
            label={chosenByUser ? 'Change plan' : 'Browse plans'}
            variant="secondary"
            size="sm"
            fullWidth
            onPress={onPressChange}
          />
        </VStack>
      </Card>
    );
  },
);

CurrentPlanCard.displayName = 'CurrentPlanCard';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

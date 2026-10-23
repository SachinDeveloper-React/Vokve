import React, { memo } from 'react';
import { PencilLine } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  /** "Log your heart rate", "Log your blood pressure". */
  title: string;
  /** Where the number comes from — "From your monitor, your clinic or your doctor". */
  helper: string;
  onPressLog: () => void;
}

/**
 * Taking a reading: the user types it in.
 *
 * This replaced a "Live Heart Rate / Live Blood Pressure" card that carried a
 * "Not connected" pill and a button labelled *Start Measuring* behind a
 * `HAS_SENSOR = false` constant. It was honest about the state and still the
 * wrong thing on the screen: it advertised a sensor integration as the real
 * way in and the manual sheet as the fallback, when every vital Vokve holds
 * is typed in and will stay that way (RULES V1). Health Connect is wired for
 * steps and distance and nothing else — no vital here has ever come from it,
 * or from any device.
 *
 * So the card says what actually happens. No pill, because there is no state
 * to report: a reading is entered, kept with its date, and plotted on the
 * trend below. The button is the screen's primary action, which is what it
 * always was.
 */
export const LogReadingCard = memo(({ title, helper, onPressLog }: Props) => (
  <Card radius="xl" padding="base">
    <VStack gap="base">
      <HStack align="center" gap="sm">
        <Icon as={PencilLine} size="sm" color="textSecondary" />
        <VStack flex={1} gap="xxs">
          <AppText variant="h3" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            {helper}
          </AppText>
        </VStack>
      </HStack>

      <Button label="Add a reading" size="lg" fullWidth onPress={onPressLog} />
    </VStack>
  </Card>
));

LogReadingCard.displayName = 'LogReadingCard';

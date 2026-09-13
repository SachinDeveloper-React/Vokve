import React, { memo } from 'react';
import { Plus } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { VitalKind, VitalReading } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { BmiGuide } from './BmiGuide';
import { VitalTile } from './VitalTile';

interface Props {
  /** The newest reading of each kind. A kind with none is simply not drawn. */
  latest: Partial<Record<VitalKind, VitalReading>>;
  onPressAdd: () => void;
  onPressBmiInfo: () => void;
  /** Heart rate and blood pressure are the vitals with screens of their own. */
  onPressHeartRate: () => void;
  onPressBloodPressure: () => void;
}

/**
 * The four vitals as they stand today, and the BMI scale that explains one of
 * them.
 *
 * Three tiles on the first row and two on the second rather than a four-up
 * grid: the BMI guide is a legend, not a reading, and giving it the fourth
 * cell would have it read as a fifth vital.
 *
 * A kind with no reading yet is left out rather than drawn empty. "Add New
 * Reading" is right there, and a tile showing a dash is a worse invitation
 * than the gap where it would sit.
 *
 * Two of the tiles open a screen and two do not, because two screens exist.
 * The other two stay plain readouts rather than pressable tiles that lead
 * nowhere.
 */
export const VitalsCard = memo(
  ({
    latest,
    onPressAdd,
    onPressBmiInfo,
    onPressHeartRate,
    onPressBloodPressure,
  }: Props) => {
    const { colors } = useTheme();

    const { heart_rate: heartRate, blood_pressure: bloodPressure, bmi, weight } =
      latest;

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="h3" numberOfLines={1}>
              Your Vitals
            </AppText>

            <Pressable
              onPress={onPressAdd}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="Add a new reading"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" color="primary">
                  Add New Reading
                </AppText>
                <Icon as={Plus} size="xs" tint={colors.primary} />
              </HStack>
            </Pressable>
          </HStack>

          <HStack align="stretch" gap="sm">
            {heartRate ? (
              <VitalTile reading={heartRate} onPress={onPressHeartRate} />
            ) : null}
            {bloodPressure ? (
              <VitalTile
                reading={bloodPressure}
                onPress={onPressBloodPressure}
              />
            ) : null}
            {bmi ? <VitalTile reading={bmi} /> : null}
          </HStack>

          <HStack align="stretch" gap="sm">
            {weight ? <VitalTile reading={weight} /> : null}
            <BmiGuide onPressInfo={onPressBmiInfo} />
          </HStack>
        </VStack>
      </Card>
    );
  },
);

VitalsCard.displayName = 'VitalsCard';

import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Flame, Footprints, MapPin, Timer } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { VerifiedActivity } from '../../stores/stepsStore';
import { formatActiveTime, formatGrouped } from '../../utils/format';
import {
  addDays,
  formatLongDate,
  todayIso,
  type IsoDate,
} from '../../utils/date';
import {
  BottomSheet,
  BottomSheetScrollView,
  useSheetBodyMaxHeight,
} from '../disclosure/BottomSheet';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { IconBadge } from '../ui/IconBadge';
import { ProgressBar } from '../ui/ProgressBar';

interface RowProps {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
}

const DetailRow = memo(({ icon, tint, label, value }: RowProps) => (
  <HStack
    align="center"
    gap="md"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <IconBadge icon={icon} tint={tint} size="sm" />
    <AppText variant="body" color="textSecondary" style={styles.label}>
      {label}
    </AppText>
    <AppText variant="bodyStrong" numberOfLines={1}>
      {value}
    </AppText>
  </HStack>
));

DetailRow.displayName = 'DetailRow';

/** "6 PM – 7 PM" — the hour a count belongs to, as the span it covers. */
function hourSpan(hour: number): string {
  const name = (value: number) => {
    const wrapped = value % 24;
    const suffix = wrapped < 12 ? 'AM' : 'PM';
    return `${wrapped % 12 === 0 ? 12 : wrapped % 12} ${suffix}`;
  };
  return `${name(hour)} – ${name(hour + 1)}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  date: IsoDate;
  /** The day cut to what the server verified, as every figure here is. */
  activity: VerifiedActivity;
  goal: number;
  /** The day before's verified count, for the comparison. Null when unknown. */
  previousSteps: number | null;
  /** The day's busiest hour. Null when it counted nothing. */
  peakHour: { hour: number; steps: number } | null;
  /**
   * The server has not answered for this day yet.
   *
   * Not the same as a day of no steps, and the difference matters: zeros read
   * as "you did not walk", which is something to be told rather than guessed
   * at. While this is set the sheet says it is fetching and draws no figures.
   */
  pending?: boolean;
  /** Moves the whole screen onto this day. */
  onShowDay?: () => void;
}

/**
 * One day in full, opened from the calendar or from the busiest-day row.
 *
 * A sheet rather than a screen, and nothing behind it moves while it is open:
 * a tap on the calendar is a look at a day, not a decision to spend the rest
 * of the screen on it. "Show this day" is there for when it was — it
 * re-anchors the screen and closes.
 *
 * The figures scroll and the two buttons do not. The sheet is capped at nine
 * tenths of the screen and its children do not shrink to fit, so laid out as
 * one column this much content pushes the buttons off the bottom edge on
 * exactly the devices least able to spare the room
 * (`useSheetBodyMaxHeight`).
 *
 * Every figure is the verified part of the day, like the rest of the screen
 * (`verifiedActivityOf`), and the line about steps still being checked is
 * drawn only when there are some: a note explaining a difference of zero
 * would be the one thing here nobody could act on.
 */
export const DayDetailSheet = memo(
  ({
    visible,
    onClose,
    date,
    activity,
    goal,
    previousSteps,
    peakHour,
    pending = false,
    onShowDay,
  }: Props) => {
    const { colors } = useTheme();
    const maxBody = useSheetBodyMaxHeight(BUTTONS_HEIGHT);

    const today = todayIso();
    const when =
      date === today
        ? 'Today'
        : date === addDays(today, -1)
        ? 'Yesterday'
        : null;

    const percent = Math.round((activity.steps / Math.max(1, goal)) * 100);
    const left = Math.max(0, goal - activity.steps);

    const delta =
      previousSteps === null || previousSteps === 0
        ? null
        : Math.round(((activity.steps - previousSteps) / previousSteps) * 100);

    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title={formatLongDate(date)}
      >
        <VStack gap="base" pb="base">
          {pending ? (
            <AppText variant="body" color="textSecondary">
              Fetching this day…
            </AppText>
          ) : (
            <BottomSheetScrollView
              style={[styles.body, { maxHeight: maxBody }]}
              showsVerticalScrollIndicator={false}
            >
              <VStack gap="base">
                {when ? (
                  <AppText variant="micro" color="textTertiary">
                    {when}
                  </AppText>
                ) : null}

                <VStack gap="sm">
                  <HStack align="baseline" justify="between" gap="sm" wrap>
                    <HStack align="baseline" gap="xs">
                      <AppText
                        variant="metric"
                        color="primary"
                        numberOfLines={1}
                      >
                        {formatGrouped(activity.steps)}
                      </AppText>
                      <AppText variant="body" color="textTertiary">
                        {`/ ${formatGrouped(goal)} steps`}
                      </AppText>
                    </HStack>

                    <AppText variant="bodyStrong" color="primary">
                      {`${percent}%`}
                    </AppText>
                  </HStack>

                  <ProgressBar progress={activity.steps / Math.max(1, goal)} />

                  <AppText variant="micro" color="textTertiary">
                    {left === 0
                      ? 'Goal met on this day.'
                      : `${formatGrouped(left)} steps short of the goal.`}
                  </AppText>
                </VStack>

                <Divider />

                <VStack gap="base">
                  <DetailRow
                    icon={MapPin}
                    tint={colors.success}
                    label="Distance"
                    value={`${activity.distanceKm.toFixed(2)} km`}
                  />
                  <DetailRow
                    icon={Flame}
                    tint={colors.destructive}
                    label="Calories burned"
                    value={formatGrouped(Math.round(activity.caloriesBurned))}
                  />
                  <DetailRow
                    icon={Timer}
                    tint={colors.brandAccent}
                    label="Active time"
                    value={formatActiveTime(activity.activeMinutes)}
                  />
                  <DetailRow
                    icon={Footprints}
                    tint={colors.primary}
                    label="Busiest hour"
                    value={
                      peakHour
                        ? `${hourSpan(peakHour.hour)} · ${formatGrouped(
                            peakHour.steps,
                          )}`
                        : '—'
                    }
                  />
                </VStack>

                {delta === null && activity.unverified === 0 ? null : (
                  <>
                    <Divider />

                    <VStack gap="xs">
                      {delta === null ? null : (
                        <AppText variant="micro" color="textSecondary">
                          {`${Math.abs(delta)}% ${
                            delta >= 0 ? 'more' : 'less'
                          } than the day before.`}
                        </AppText>
                      )}

                      {/*
                        Said plainly rather than left as a gap between two
                        numbers: a reader who counted 9,000 steps and is shown
                        7,400 is owed the reason, and "still being checked" is
                        the true one.
                      */}
                      {activity.unverified > 0 ? (
                        <AppText variant="micro" color="textTertiary">
                          {`${formatGrouped(
                            activity.unverified,
                          )} more steps were counted on a phone and are still being checked.`}
                        </AppText>
                      ) : null}
                    </VStack>
                  </>
                )}
              </VStack>
            </BottomSheetScrollView>
          )}

          <VStack gap="sm">
            {onShowDay ? (
              <Button
                label="Show this day"
                variant="brand"
                fullWidth
                onPress={onShowDay}
              />
            ) : null}
            <Button
              label="Close"
              variant={onShowDay ? 'ghost' : 'primary'}
              fullWidth
              onPress={onClose}
            />
          </VStack>
        </VStack>
      </BottomSheet>
    );
  },
);

DayDetailSheet.displayName = 'DayDetailSheet';

/** The buttons and the gap between them, which stay out of the scroll. */
const BUTTONS_HEIGHT = moderateScale(112);

const styles = StyleSheet.create({
  /** Grows with the content until the sheet runs out of room, then scrolls. */
  body: { flexShrink: 1 },
  /** The label takes the slack so the figure stays hard against the right. */
  label: { flex: 1 },
});

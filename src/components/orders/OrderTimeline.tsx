import React, { Fragment, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { DeliveryWindow, OrderTimelineEntry } from '../../types/models';
import { formatClockTime, formatDayMonthYear, formatDayRange } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

const DOT = moderateScale(18);

interface Props {
  /** The stops as the server listed them — made, and still to come. */
  entries: readonly OrderTimelineEntry[];
  /**
   * When the courier should have it, as the order promised. It dates the
   * one stop that has no time of its own yet.
   */
  estimatedDelivery?: DeliveryWindow | null;
}

const makeStyles = ({ colors, spacing }: ThemeShape) =>
  StyleSheet.create({
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 2,
      borderColor: colors.border,
      marginTop: spacing.xxs,
    },
    done: {
      backgroundColor: colors.brandAccent,
      borderColor: colors.brandAccent,
    },
    /** The thread between one stop and the next, under the dot. */
    thread: {
      width: 2,
      flex: 1,
      minHeight: moderateScale(14),
      backgroundColor: colors.border,
      marginVertical: spacing.xxs,
    },
    threadDone: { backgroundColor: colors.brandAccent },
    rail: { alignItems: 'center' },
    row: { paddingBottom: spacing.md },
  });

/**
 * Everything that has happened to this order, and what has not yet
 * (RULES R5).
 *
 * The stops and their times are the server's: it keeps an event for every
 * transition, so this is the only place the app can honestly say a parcel
 * was packed at 11:15 rather than merely that it is packed. A stop still
 * ahead is drawn as an open ring marked "Pending", and the last one
 * carries the delivery window the order promised, which is the question
 * the member opened this page with.
 */
export const OrderTimeline = memo(({ entries, estimatedDelivery }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <VStack>
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        const next = entries[index + 1];
        // A stop that has happened is dated by its own event. The one stop
        // that has not and still has something to say is the door: the
        // window the order promised when it was placed.
        const caption =
          entry.at !== null
            ? `${formatDayMonthYear(entry.at)}, ${formatClockTime(entry.at)}`
            : entry.status === 'delivered' && estimatedDelivery
            ? `Expected by ${formatDayRange(
                estimatedDelivery.from,
                estimatedDelivery.to,
              )}`
            : null;
        return (
          <Fragment key={`${entry.status}-${index}`}>
            <HStack align="start" gap="md">
              <View style={styles.rail}>
                <View style={[styles.dot, entry.done && styles.done]} />
                {!last ? (
                  <View
                    style={[
                      styles.thread,
                      next?.done === true && styles.threadDone,
                    ]}
                  />
                ) : null}
              </View>

              <HStack
                flex={1}
                align="start"
                justify="between"
                gap="sm"
                style={last ? undefined : styles.row}
              >
                <VStack flex={1} gap="xxs">
                  <AppText
                    variant="bodyStrong"
                    color={entry.done ? undefined : 'textSecondary'}
                  >
                    {entry.title}
                  </AppText>
                  {caption ? (
                    <AppText variant="micro" color="textTertiary">
                      {caption}
                    </AppText>
                  ) : null}
                </VStack>
                <AppText
                  variant="micro"
                  style={{
                    color: entry.done ? colors.success : colors.textTertiary,
                  }}
                >
                  {entry.done ? 'Done' : 'Pending'}
                </AppText>
              </HStack>
            </HStack>
          </Fragment>
        );
      })}
    </VStack>
  );
});

OrderTimeline.displayName = 'OrderTimeline';

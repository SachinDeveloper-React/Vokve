import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { moderateScale } from '../../theme/responsive';
import { spacing, useTheme } from '../../theme';
import type { Achievement } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { AchievementBadge } from './AchievementBadge';

/** Badges per page. Five is what fits across a 375pt card without crowding. */
const PAGE_SIZE = 5;
const DOT = moderateScale(6);

interface Props {
  achievements: Achievement[];
  onPressViewAll: () => void;
}

function paginate(achievements: Achievement[]): Achievement[][] {
  const pages: Achievement[][] = [];
  for (let i = 0; i < achievements.length; i += PAGE_SIZE) {
    pages.push(achievements.slice(i, i + PAGE_SIZE));
  }
  return pages;
}

/**
 * The achievement shelf, five to a page.
 *
 * Paged rather than free-scrolling: the badges are a grid of equal columns, and
 * a strip that stopped halfway through one would cut a ring down its middle.
 * Paging also gives the dots underneath something true to say — they are a
 * position, not decoration.
 *
 * The page width is measured rather than calculated. The card sits inside the
 * screen's padding inside a scroll view, and a width derived from the window
 * would be wrong by however much of that chain changes.
 */
export const AchievementsCard = memo(
  ({ achievements, onPressViewAll }: Props) => {
    const { colors } = useTheme();
    const [pageWidth, setPageWidth] = useState(0);
    const [page, setPage] = useState(0);

    const pages = useMemo(() => paginate(achievements), [achievements]);

    const handleLayout = useCallback(
      (event: LayoutChangeEvent) =>
        setPageWidth(event.nativeEvent.layout.width),
      [],
    );

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const width = event.nativeEvent.layoutMeasurement.width;
        if (width > 0) {
          setPage(Math.round(event.nativeEvent.contentOffset.x / width));
        }
      },
      [],
    );

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="label" color="textSecondary">
              Achievements
            </AppText>

            <Pressable
              onPress={onPressViewAll}
              feedback="opacity"
              accessibilityRole="link"
              accessibilityLabel="View all achievements"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" color="textSecondary">
                  View All
                </AppText>
                <Icon as={ChevronRight} size="xs" color="textSecondary" />
              </HStack>
            </Pressable>
          </HStack>

          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onLayout={handleLayout}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {pages.map(group => (
              <HStack
                key={group[0]?.id}
                align="start"
                gap="xs"
                style={{ width: pageWidth }}
              >
                {group.map(achievement => (
                  <AchievementBadge
                    key={achievement.id}
                    achievement={achievement}
                  />
                ))}

                {/* Keeps a short last page's columns the width of a full one. */}
                {Array.from({ length: PAGE_SIZE - group.length }, (_, index) => (
                  <View key={`gap-${index}`} style={styles.filler} />
                ))}
              </HStack>
            ))}
          </ScrollView>

          {pages.length > 1 ? (
            <HStack
              align="center"
              justify="center"
              gap="xs"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {pages.map((group, index) => (
                <View
                  key={group[0]?.id}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        index === page ? colors.text : colors.textQuaternary,
                    },
                  ]}
                />
              ))}
            </HStack>
          ) : null}
        </VStack>
      </Card>
    );
  },
);

AchievementsCard.displayName = 'AchievementsCard';

const styles = StyleSheet.create({
  filler: { flex: 1 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: spacing.xxs },
});

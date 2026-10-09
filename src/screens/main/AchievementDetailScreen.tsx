import React, { useCallback, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowRight, ChevronLeft, Share2 } from 'lucide-react-native';
import {
  AchievementAboutCard,
  AchievementCheerCard,
  AchievementFactsRow,
  AchievementHeroCard,
  AchievementProgressDetailCard,
  RelatedAchievementsCard,
} from '../../components/challenges';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { Pressable } from '../../components/form/Pressable';
import { useAchievementDetail } from '../../hooks/useChallenges';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { AchievementCta } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xl, gap: spacing.md },
    header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
    // The chevron and the share icon hold the same width, so the title sits
    // centred between them.
    side: { width: 32 },
    /** Bleeds through the screen's gutter so the rule runs edge to edge. */
    bar: {
      marginHorizontal: -spacing.base,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  });

/**
 * One badge in full: what it is, how close the member is, what it pays, when
 * it landed, and where it sits among the others like it.
 *
 * Everything is the server's (`GET /achievements/:id`) — including the
 * wording. The description, the "about" paragraph and the line under the
 * status chip are all derived from the rule the server actually enforces
 * (RULES C7), so a threshold the owner rebalances cannot leave the app
 * explaining the old one.
 *
 * There is nothing to claim here either. A badge unlocks itself the moment
 * the member's best on record reaches it, so the button at the foot is only
 * ever a way on: to the next rung of the same ladder while there is one, and
 * back to the shelf once there is not — which of the two is the server's call,
 * not the app's.
 *
 * Tapping a related badge replaces this screen's subject rather than pushing
 * another copy of it: a ladder is something a reader walks up and down, and
 * five taps should not leave five screens to back out of.
 */
export const AchievementDetailScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RootStackScreenProps<'AchievementDetail'>['route']>();

  const [id, setId] = useState(params.id);
  const detail = useAchievementDetail(id);

  const [refreshing, setRefreshing] = useState(false);
  const { reload } = detail;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncStepsNow();
    } finally {
      reload();
      setRefreshing(false);
    }
  }, [reload]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Achievements');
  }, [navigation]);

  const shareText = detail.data?.shareText;
  const onPressShare = useCallback(() => {
    if (!shareText) return;
    // A dismissed share is the user's to cancel, not an error worth a dialog.
    Share.share({ message: shareText }).catch(() => {});
  }, [shareText]);

  const onOpenShelf = useCallback(
    () => navigation.navigate('Achievements'),
    [navigation],
  );

  const action = detail.data?.cta.action;
  const onPressCta = useCallback(() => {
    const go: Record<AchievementCta['action'], () => void> = {
      track_steps: () => navigation.navigate('StepTracking'),
      go_home: () => navigation.navigate('Main', { screen: 'Home' }),
      view_shelf: onOpenShelf,
      none: () => {},
    };
    if (action) go[action]();
  }, [action, navigation, onOpenShelf]);

  const header = (
    <HStack align="center" gap="sm" style={styles.header}>
      <Pressable
        onPress={onPressBack}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.side}
      >
        <Icon as={ChevronLeft} size="lg" color="text" />
      </Pressable>

      <VStack flex={1} align="center" gap="xxs">
        <AppText variant="h2" accessibilityRole="header" numberOfLines={1}>
          Achievement Details
        </AppText>
        <AppText variant="micro" color="textSecondary" center numberOfLines={1}>
          Keep going. Every step counts.
        </AppText>
      </VStack>

      <Pressable
        onPress={onPressShare}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Share this achievement"
        style={styles.side}
      >
        <Icon as={Share2} size="md" color="text" />
      </Pressable>
    </HStack>
  );

  if (!detail.data) {
    return (
      <Screen edges={['top']}>
        {header}
        <LoadState
          loading={detail.loading}
          title="Couldn't load this achievement"
          message={detail.error}
          onRetry={detail.reload}
        />
      </Screen>
    );
  }

  const { cta } = detail.data;

  return (
    <Screen edges={['top', 'bottom']}>
      {header}

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <AchievementHeroCard detail={detail.data} />

        <AchievementProgressDetailCard detail={detail.data} />

        <AchievementFactsRow detail={detail.data} />

        <AchievementCheerCard
          cheer={detail.data.cheer}
          unlocked={detail.data.unlocked}
        />

        <AchievementAboutCard about={detail.data.about} />

        <RelatedAchievementsCard
          related={detail.data.related}
          currentId={detail.data.achievement.id}
          onPressAchievement={setId}
          onPressViewAll={onOpenShelf}
        />
      </ScrollView>

      <View style={styles.bar}>
        {cta.action === 'none' ? (
          <AppText variant="caption" color="textSecondary" center>
            {cta.label}
          </AppText>
        ) : (
          <Button
            label={cta.label}
            variant="brand"
            size="lg"
            fullWidth
            onPress={onPressCta}
            icon={
              <Icon as={ArrowRight} size="sm" tint={colors.primaryForeground} />
            }
            iconPosition="trailing"
          />
        )}
      </View>
    </Screen>
  );
};

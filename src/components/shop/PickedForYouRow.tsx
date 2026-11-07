import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ShopSuggestion } from '../../types/models';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppImage } from '../media/AppImage';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

const TILE = moderateScale(132);
const ART = moderateScale(96);

interface TileProps {
  suggestion: ShopSuggestion;
  onPress: (itemId: string) => void;
}

const SuggestionTile = memo(({ suggestion, onPress }: TileProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(suggestion.itemId), [onPress, suggestion.itemId]);

  return (
    <Pressable
      onPress={press}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${suggestion.title}, ${formatCoins(
        suggestion.coinPrice,
      )} coins. ${suggestion.reason}`}
      style={styles.tile}
    >
      <VStack gap="sm">
        <AppImage
          uri={suggestion.imageUrl}
          width={TILE}
          height={ART}
          radius="lg"
          fallback={
            <VStack
              align="center"
              justify="center"
              style={[styles.art, { backgroundColor: colors.muted }]}
            >
              <Emoji size="lg">{suggestion.emoji ?? '🎁'}</Emoji>
            </VStack>
          }
        />

        <VStack gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={2}>
            {suggestion.title}
          </AppText>
          <AppText
            variant="micro"
            style={{
              // Grey when the coins do not cover it, so the price stops
              // reading as a button. The item is still here, because
              // hiding it would decide for them that they never will.
              color: suggestion.affordable ? colors.success : colors.textTertiary,
            }}
          >
            {`${formatCoins(suggestion.coinPrice)} coins`}
          </AppText>
          <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
            {suggestion.reason}
          </AppText>
        </VStack>
      </VStack>
    </Pressable>
  );
});

SuggestionTile.displayName = 'SuggestionTile';

interface Props {
  suggestions: ShopSuggestion[];
  onPressItem: (itemId: string) => void;
}

/**
 * The shelf picked for one member (RULES R19).
 *
 * Each tile carries the reason it is there, because a shop that quietly
 * reorders itself is a shop nobody trusts and nobody can debug: "you have
 * bought from gym before" is a sentence the member can check against
 * their own history, and an operator can check against the rules.
 *
 * What they cannot yet afford is here too, with its price greyed. A coin
 * shop makes that failure particular — the member can see exactly how
 * short they are — and dropping those items would be deciding on their
 * behalf that they will never save up for one.
 *
 * Nothing is drawn at all when there is nothing to suggest. Unlike the
 * day's food, where an empty shelf is an answer worth saying ("the day is
 * done"), a shop with no picks has nothing to tell anybody.
 */
export const PickedForYouRow = memo(({ suggestions, onPressItem }: Props) => {
  const { colors } = useTheme();
  if (suggestions.length === 0) return null;

  return (
    <Card radius="xl" padding="base">
      <VStack gap="md">
        <HStack align="center" gap="sm">
          <Icon as={Sparkles} size="sm" tint={colors.brandAccent} />
          <AppText variant="label" color="textSecondary" numberOfLines={1}>
            Picked for you
          </AppText>
        </HStack>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {suggestions.map(suggestion => (
            <SuggestionTile
              key={suggestion.itemId}
              suggestion={suggestion}
              onPress={onPressItem}
            />
          ))}
        </ScrollView>
      </VStack>
    </Card>
  );
});

PickedForYouRow.displayName = 'PickedForYouRow';

const styles = StyleSheet.create({
  row: { gap: spacing.md },
  tile: { width: TILE },
  art: { width: TILE, height: ART, borderRadius: radius.lg },
});

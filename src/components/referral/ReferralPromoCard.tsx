import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { ArrowRight } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ReferralCard, ReferralPosition } from '../../types/models';
import { readableOn, withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The card as the server wrote it, or null — then nothing is drawn. */
  card: ReferralCard | null;
  /**
   * Which of the screen's three anchors this one is.
   *
   * A screen renders all three and each draws only the card that asks for
   * it, so moving the banner up the page is a field on the row rather than a
   * change here. Left out, it is the foot of the scroll — which is where a
   * server from before this shipped puts every card.
   */
  at?: ReferralPosition;
  onPress: () => void;
}

/** The glyph sitting behind the words, bled off the banner's right edge. */
const ART = moderateScale(132);
/** How tall the banner stands, before its content asks for more. */
const MIN_HEIGHT = moderateScale(138);

/**
 * The invite, wherever the server has put one.
 *
 * Drawn as an advertising banner rather than as a card: it is the one thing
 * on these screens asking for something instead of reporting it, and a
 * bordered card in the same surface as the figures above it reads as another
 * figure. So it fills itself with the accent and puts its words *on* that
 * field — which is how a promo is told apart from the page it sits on at a
 * glance, without reading a word of it.
 *
 * Every word, the colour and the glyph are the server's (`ReferralCard`), so
 * a campaign is an edit in the panel rather than a release, and the same
 * component draws the banner on all ten screens that can carry one. Null
 * draws nothing at all: a screen the operator has written no card for shows
 * no banner, which is how the invite is turned off in one place.
 *
 * *Where* on the screen is the server's too. Each screen renders this at
 * three anchors — under its headline, after its first block of content, and
 * at the foot — and each instance draws only the card whose `position` names
 * it. So a banner is moved up the page from the panel, and the alternative,
 * one anchor per screen chosen in a release, is what had every one of them
 * sitting at the bottom where nobody scrolls.
 *
 * The text colour is chosen from the accent's own luminance (`readableOn`)
 * rather than fixed to white. The accents are lighter in dark mode — the
 * brand orange goes from `rgb(234, 88, 12)` to `rgb(251, 146, 60)`, and gold
 * is lighter still — so white would be right on half of them and thin on the
 * rest, in a place where the words are the whole point.
 *
 * The coin figure comes from `inviterCoins`, not from the sentence. The
 * server has already written its own number into the message; two sources
 * for one promise is how they come to disagree, so the badge states the
 * figure and the sentence makes the pitch.
 */
export const ReferralPromoCard = memo(({ card, at = 'bottom', onPress }: Props) => {
  const { colors } = useTheme();
  // Three of these are on every screen and at most one of them draws.
  if (card === null || card.position !== at) return null;

  const tint =
    card.accent === 'gold'
      ? colors.gold
      : card.accent === 'success'
      ? colors.success
      : card.accent === 'primary'
      ? colors.primary
      : colors.brandAccent;

  const onLight = readableOn(tint) === 'dark';
  const ink = onLight ? 'rgba(15, 23, 42, 1)' : 'rgba(248, 250, 252, 1)';
  const quiet = withAlpha(ink, 0.76);
  /** The button's own fill: paper on a light accent, the card surface on a dark one. */
  const ctaFill = onLight ? 'rgba(255, 255, 255, 0.92)' : colors.card;
  /** The sheen over the fill: a highlight at the top, a shade at the foot. */
  const sheen = onLight
    ? ['rgba(255, 255, 255, 0.26)', 'rgba(0, 0, 0, 0.1)']
    : ['rgba(255, 255, 255, 0.18)', 'rgba(0, 0, 0, 0.22)'];

  return (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${card.message}`}
      accessibilityHint={card.ctaLabel}
    >
      <View
        style={[
          styles.banner,
          { backgroundColor: tint, minHeight: MIN_HEIGHT },
        ]}
      >
        <LinearGradient
          colors={sheen}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/*
          The glyph, large and half off the edge. Decoration, and hidden as
          such: it says nothing the sentence does not, and a screen reader
          announcing an emoji in the middle of the pitch reads as a stutter.
        */}
        <View
          style={styles.art}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Emoji size={ART * 0.52}>{card.emoji}</Emoji>
        </View>

        <VStack gap="sm" style={styles.body}>
          {card.inviterCoins > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: withAlpha(ink, onLight ? 0.12 : 0.2) },
              ]}
            >
              <AppText
                variant="miniMicro"
                style={[styles.badgeText, { color: ink }]}
              >
                {`EARN ${formatCoins(card.inviterCoins)} COINS`}
              </AppText>
            </View>
          ) : null}

          <VStack gap="xxs">
            <AppText variant="h3" numberOfLines={2} style={{ color: ink }}>
              {card.title}
            </AppText>
            <AppText variant="micro" numberOfLines={3} style={{ color: quiet }}>
              {card.message}
            </AppText>
          </VStack>

          {/*
            A filled pill rather than a text link: a banner is read as an
            advert and an advert is expected to have a button, so a link here
            reads as a caption that happens to be tappable.
          */}
          <HStack
            align="center"
            gap="xs"
            style={[styles.cta, { backgroundColor: ctaFill }]}
          >
            <AppText
              variant="micro"
              numberOfLines={1}
              style={[styles.ctaText, { color: tint }]}
            >
              {card.ctaLabel}
            </AppText>
            <Icon as={ArrowRight} size="xs" tint={tint} />
          </HStack>
        </VStack>
      </View>
    </Pressable>
  );
});

ReferralPromoCard.displayName = 'ReferralPromoCard';

const styles = StyleSheet.create({
  /**
   * `overflow: hidden` is what keeps the sheen and the glyph inside the
   * rounded corners instead of letting either hang off the edge.
   */
  banner: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  /** Padded on the right for the art, so a long heading stops before it. */
  body: {
    padding: spacing.base,
    paddingRight: ART * 0.62,
    alignItems: 'flex-start',
  },
  art: {
    position: 'absolute',
    width: ART,
    height: ART,
    right: -ART * 0.16,
    top: -ART * 0.12,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    transform: [{ rotate: '-8deg' }],
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeText: { fontWeight: '800', letterSpacing: 0.8 },
  cta: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  ctaText: { fontWeight: '700' },
});

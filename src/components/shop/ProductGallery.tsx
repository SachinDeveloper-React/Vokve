import React, { memo, useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ShopItem } from '../../types/models';
import { HStack } from '../layout/Stack';
import { AppImage } from '../media/AppImage';
import { Emoji } from '../media/Emoji';
import { WishlistButton } from './WishlistButton';

interface Props {
  item: ShopItem;
}

const DOT = moderateScale(8);

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    frame: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    well: {
      aspectRatio: 0.82,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      overflow: 'hidden',
    },
    slide: { alignItems: 'center', justifyContent: 'center' },
    heart: { position: 'absolute', top: spacing.sm, right: spacing.sm },
    soldOut: { opacity: 0.5 },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 1.5,
      borderColor: colors.brandAccent,
    },
  });

/**
 * The item's photos, a page at a time, with the heart over the corner and
 * a dot per photo underneath.
 *
 * Until the catalogue ships photos an item has none, and the well shows its
 * emoji instead — one page, so no dots: a row of dots promising pictures
 * that are not there would be a lie the user swipes to discover.
 */
export const ProductGallery = memo(({ item }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [page, setPage] = useState(0);
  const pages = item.images.length > 0 ? item.images : [null];

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(prev =>
      prev && prev.width === width && prev.height === height
        ? prev
        : { width, height },
    );
  }, []);

  const onScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!size || size.width === 0) return;
      setPage(Math.round(event.nativeEvent.contentOffset.x / size.width));
    },
    [size],
  );

  const renderPage = useCallback<ListRenderItem<string | null>>(
    ({ item: uri }) =>
      size ? (
        <View style={[styles.slide, size]}>
          <AppImage
            uri={uri}
            width={size.width}
            height={size.height}
            radius="none"
            resizeMode="cover"
            accessibilityLabel={item.title}
            fallback={
              <Emoji size={moderateScale(64)} label={item.title}>
                {item.emoji}
              </Emoji>
            }
          />
        </View>
      ) : null,
    [item.emoji, item.title, size, styles.slide],
  );

  return (
    <View style={styles.frame}>
      <View
        style={[styles.well, !item.inStock && styles.soldOut]}
        onLayout={onLayout}
      >
        {size ? (
          <FlatList
            data={pages}
            keyExtractor={(uri, index) => `${index}:${uri ?? 'emoji'}`}
            renderItem={renderPage}
            horizontal
            pagingEnabled
            scrollEnabled={pages.length > 1}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
          />
        ) : null}
      </View>

      <View style={styles.heart}>
        <WishlistButton item={item} size="md" />
      </View>

      {pages.length > 1 ? (
        <HStack
          justify="center"
          gap="xs"
          accessibilityLabel={`Photo ${page + 1} of ${pages.length}`}
        >
          {pages.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === page && { backgroundColor: colors.brandAccent },
              ]}
            />
          ))}
        </HStack>
      ) : null}
    </View>
  );
});

ProductGallery.displayName = 'ProductGallery';

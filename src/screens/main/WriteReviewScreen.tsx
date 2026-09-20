import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Trash2 } from 'lucide-react-native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { useToast } from '../../components/feedback/Toast';
import { Input } from '../../components/form/Input';
import { TextArea } from '../../components/form/TextArea';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { Emoji } from '../../components/media/Emoji';
import { RatingPicker } from '../../components/shop/RatingStars';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { shopApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopItem, useShopStore } from '../../stores/shopStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Review } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** The server's floor and ceiling for the words, mirrored so the form can say so before sending. */
const MIN_BODY = 10;
const MAX_BODY = 1000;
const MAX_TITLE = 80;

/**
 * Write a review, or change the one already written (RULES R15): stars,
 * a title if wanted, the words. One per item, so opening this with a
 * review on file edits it — and offers to delete it.
 */
export const WriteReviewScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'WriteReview'>['route']>();
  const { itemId } = route.params;
  const toast = useToast();
  const balance = useCoinBalance();
  const item = useShopItem(itemId);
  const hydrateCatalogue = useShopStore(s => s.hydrateFromServer);

  const [existing, setExisting] = useState<Review | null>(null);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A review already on file fills the form: this is an edit.
  useEffect(() => {
    let cancelled = false;
    shopApi
      .reviews(itemId, { limit: 1 })
      .then(page => {
        if (cancelled || !page.mine) return;
        setExisting(page.mine);
        setRating(page.mine.rating);
        setTitle(page.mine.title ?? '');
        setBody(page.mine.body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('ProductDetail', { id: itemId });
  }, [itemId, navigation]);

  const trimmed = body.trim();
  const bodyError =
    trimmed.length > 0 && trimmed.length < MIN_BODY
      ? `Say a little more — at least ${MIN_BODY} characters.`
      : null;
  const canSubmit = rating > 0 && trimmed.length >= MIN_BODY && !isSubmitting;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) {
      setError(rating === 0 ? 'Tap a star to rate it.' : bodyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await shopApi.writeReview(itemId, {
        rating,
        title: title.trim() || null,
        body: trimmed,
      });
      hydrateCatalogue();
      toast.show({
        title: existing ? 'Review updated' : 'Thanks for your review',
        message: item?.title,
        tone: 'success',
      });
      onPressBack();
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(apiError.fieldErrors.body ?? apiError.message);
      setSubmitting(false);
    }
  }, [
    bodyError,
    canSubmit,
    existing,
    hydrateCatalogue,
    item?.title,
    itemId,
    onPressBack,
    rating,
    title,
    toast,
    trimmed,
  ]);

  const onDelete = useCallback(async () => {
    setSubmitting(true);
    try {
      await shopApi.deleteReview(itemId);
      hydrateCatalogue();
      toast.show({ title: 'Review deleted', tone: 'info' });
      onPressBack();
    } catch (caught) {
      setError(toApiError(caught).message);
      setSubmitting(false);
    }
  }, [hydrateCatalogue, itemId, onPressBack, toast]);

  const deleteActions = useMemo(
    () => [
      {
        label: 'Delete my review',
        icon: Trash2,
        destructive: true,
        onPress: onDelete,
      },
    ],
    [onDelete],
  );

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title={existing ? 'Edit your review' : 'Write a review'}
          subtitle={item?.title ?? ' '}
        />

        {item ? (
          <Card radius="xl" padding="base">
            <HStack align="center" gap="md">
              <Emoji size={moderateScale(32)} label={item.title}>
                {item.emoji}
              </Emoji>
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="micro" color="textTertiary">
                  Your name shows as your first name only.
                </AppText>
              </VStack>
            </HStack>
          </Card>
        ) : null}

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <AppText variant="label" color="textSecondary">
              Your rating
            </AppText>
            <RatingPicker value={rating} onChange={setRating} />
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <Input
              label="Title (optional)"
              value={title}
              onChangeText={setTitle}
              placeholder="Sum it up in a few words"
              maxLength={MAX_TITLE}
              accessibilityLabel="Review title"
            />
            <TextArea
              label="Your review"
              value={body}
              onChangeText={setBody}
              placeholder="How does it fit? Does it last? What surprised you?"
              rows={5}
              maxLength={MAX_BODY}
              showCount
              error={bodyError ?? undefined}
              accessibilityLabel="Review text"
            />
          </VStack>
        </Card>

        {error ? (
          <AppText variant="caption" color="destructive" center>
            {error}
          </AppText>
        ) : null}

        <Button
          label={existing ? 'Save changes' : 'Post review'}
          variant="brand"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={onSubmit}
        />
        {existing ? (
          <Button
            label="Delete review"
            variant="secondary"
            fullWidth
            disabled={isSubmitting}
            onPress={() => setDeleteOpen(true)}
          />
        ) : null}
      </KeyboardAwareScrollView>

      <ActionSheet
        visible={isDeleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your review?"
        message="It comes off the item straight away. You can write another later."
        actions={deleteActions}
        cancelLabel="Keep it"
      />
    </Screen>
  );
};

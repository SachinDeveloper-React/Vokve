import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { BrandSignOff } from '../../components/brand/BrandSignOff';
import { Divider } from '../../components/layout/Divider';
import { PageHeader } from '../../components/layout/PageHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { SUPPORT_ICON, supportTint } from '../../components/support/supportLooks';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconBadge } from '../../components/ui/IconBadge';
import { Screen } from '../../components/ui/Screen';
import { supportApi } from '../../services/api/endpoints';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { AppGuide } from '../../types/models';

const STEP = moderateScale(24);

const makeStyles = ({ colors, spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    /** The numbered bead beside a step. */
    bead: {
      width: STEP,
      height: STEP,
      borderRadius: STEP / 2,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signOff: { paddingTop: spacing.lg },
  });

/**
 * How to use VOKVE, chapter by chapter.
 *
 * The guide is the server's rather than the bundle's for the same reason
 * the help articles are: it goes stale the day a screen changes, and
 * support should be able to correct it that day rather than at the next
 * release. Numbered steps rather than prose, because that is how it is
 * read — phone in one hand, the app open in the other.
 */
export const AppGuideScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [guide, setGuide] = useState<AppGuide | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supportApi
      .guide()
      .then(result => {
        if (!cancelled) setGuide(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HelpSupport');
  }, [navigation]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          title={guide?.title ?? 'App Guide'}
          subtitle={guide?.subtitle ?? 'How to use VOKVE (step by step)'}
          onPressBack={onPressBack}
        />

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : guide === null || guide.sections.length === 0 ? (
          <Card radius="xl">
            <EmptyState
              title="The guide is on its way"
              message="We are writing it. Meanwhile, the help centre has an answer for most things."
            />
          </Card>
        ) : (
          <>
            {guide.sections.map(section => (
              <Card key={section.id} radius="xl" padding="base">
                <VStack gap="md">
                  <HStack align="center" gap="md">
                    <IconBadge
                      icon={SUPPORT_ICON[section.icon]}
                      tint={supportTint(section.tint, colors)}
                      size={40}
                    />
                    <VStack flex={1} gap="xxs">
                      <AppText variant="h3" accessibilityRole="header">
                        {section.title}
                      </AppText>
                      {section.summary ? (
                        <AppText variant="micro" color="textSecondary">
                          {section.summary}
                        </AppText>
                      ) : null}
                    </VStack>
                  </HStack>

                  <Divider />

                  {section.steps.map((step, index) => (
                    <HStack
                      key={`${section.id}-${index}`}
                      align="start"
                      gap="md"
                    >
                      <View style={styles.bead}>
                        <AppText variant="miniMicro" color="textSecondary">
                          {String(index + 1)}
                        </AppText>
                      </View>
                      <VStack flex={1} gap="xxs">
                        <AppText variant="bodyStrong">{step.title}</AppText>
                        <AppText variant="caption" color="textSecondary">
                          {step.body}
                        </AppText>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Card>
            ))}

            <View style={styles.signOff}>
              <BrandSignOff />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
};

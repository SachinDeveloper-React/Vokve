import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  ChevronRight,
  CircleCheck,
  ExternalLink,
  FileText,
  Mail,
  Scale,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react-native';
import { Alert } from '../../components/feedback/Alert';
import { useToast } from '../../components/feedback/Toast';
import { Pressable } from '../../components/form/Pressable';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { Wordmark } from '../../components/brand/Wordmark';
import { appApi } from '../../services/api/endpoints';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { AppAbout } from '../../types/models';
import { formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xl, alignItems: 'center' },
    brand: {
      alignItems: 'center',
      paddingVertical: spacing.lg,
      gap: spacing.xs,
    },
    row: { paddingVertical: spacing.sm },
    grow: { flex: 1 },
  });

/** The links every store requires an app to carry, and where each one goes. */
const LINKS: {
  key: keyof AppAbout['links'];
  label: string;
  icon: typeof FileText;
}[] = [
  { key: 'privacy', label: 'Privacy policy', icon: ShieldCheck },
  { key: 'terms', label: 'Terms of use', icon: FileText },
  { key: 'licenses', label: 'Open-source licences', icon: Scale },
  { key: 'website', label: 'vokve.app', icon: ExternalLink },
];

/**
 * What this build is, whether it is current, and everywhere the legal text
 * lives.
 *
 * The server judges the version rather than the app comparing strings to a
 * constant it shipped with: the minimum moves without a release, and a
 * build that is about to be refused should be the first to say so. This is
 * also the one authenticated-looking screen a blocked build can still
 * reach, which is exactly why it is the screen that tells it to update.
 */
export const AboutScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const balance = useCoinBalance();

  const [about, setAbout] = useState<AppAbout | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    appApi
      .about()
      .then(result => {
        if (!cancelled) setAbout(result);
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
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  const open = useCallback(
    (url: string) => async () => {
      try {
        await Linking.openURL(url);
      } catch {
        toast.show({
          title: "Couldn't open that",
          message: 'No app on this phone can open the link.',
          tone: 'warning',
        });
      }
    },
    [toast],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="About VOKVE"
          subtitle={about ? `${about.company} · version ${about.version}` : ' '}
        />

        <View style={styles.brand}>
          <Wordmark size="lg" />
          <AppText variant="caption" color="textSecondary">
            Move more. Earn as you go.
          </AppText>
        </View>

        {about === null ? (
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <Card radius="xl" padding="base">
              <AppText variant="caption" color="textSecondary" center>
                Version details are unavailable offline.
              </AppText>
            </Card>
          )
        ) : (
          <>
            {about.updateRequired ? (
              <Alert
                tone="error"
                title="This version is no longer supported"
                message={`Update to ${
                  about.latestVersion ?? about.minVersion
                } to keep using VOKVE.`}
                action={
                  <Button
                    label="Update"
                    variant="brand"
                    size="xs"
                    onPress={open(about.storeUrl)}
                  />
                }
              />
            ) : about.updateAvailable ? (
              <Alert
                tone="info"
                title={`Version ${about.latestVersion} is out`}
                message="Update for the latest fixes and features."
                action={
                  <Button
                    label="Update"
                    variant="secondary"
                    size="xs"
                    onPress={open(about.storeUrl)}
                  />
                }
              />
            ) : null}

            <Card radius="xl" padding="base">
              <VStack gap="md">
                <HStack align="center" justify="between">
                  <AppText variant="label" color="textSecondary">
                    This build
                  </AppText>
                  <HStack align="center" gap="xxs">
                    <Icon
                      as={about.updateRequired ? TriangleAlert : CircleCheck}
                      size="xs"
                      tint={
                        about.updateRequired
                          ? colors.destructive
                          : colors.success
                      }
                    />
                    <AppText
                      variant="micro"
                      style={{
                        color: about.updateRequired
                          ? colors.destructive
                          : colors.success,
                      }}
                    >
                      {about.updateRequired
                        ? 'Unsupported'
                        : about.updateAvailable
                        ? 'Update available'
                        : 'Up to date'}
                    </AppText>
                  </HStack>
                </HStack>
                <HStack align="center" justify="between">
                  <AppText variant="body" color="textSecondary">
                    Version
                  </AppText>
                  <AppText variant="bodyStrong">
                    {about.build
                      ? `${about.version} (${about.build})`
                      : about.version}
                  </AppText>
                </HStack>
                <HStack align="center" justify="between">
                  <AppText variant="body" color="textSecondary">
                    Minimum supported
                  </AppText>
                  <AppText variant="body">{about.minVersion}</AppText>
                </HStack>
              </VStack>
            </Card>

            {about.releaseNotes.length > 0 ? (
              <Card radius="xl" padding="base">
                <VStack gap="md">
                  <AppText variant="label" color="textSecondary">
                    What's new
                  </AppText>
                  {about.releaseNotes.slice(0, 5).map((release, index) => (
                    <React.Fragment key={`${release.version}-${index}`}>
                      {index > 0 ? <Divider /> : null}
                      <VStack gap="xxs">
                        <HStack align="center" justify="between">
                          <AppText variant="bodyStrong">
                            {release.version}
                          </AppText>
                          {release.releasedAt ? (
                            <AppText variant="micro" color="textTertiary">
                              {formatRelativeDay(release.releasedAt)}
                            </AppText>
                          ) : null}
                        </HStack>
                        {release.notes ? (
                          <AppText variant="caption" color="textSecondary">
                            {release.notes}
                          </AppText>
                        ) : null}
                      </VStack>
                    </React.Fragment>
                  ))}
                </VStack>
              </Card>
            ) : null}

            <Card radius="xl" padding="base">
              <VStack gap="xs">
                <AppText variant="label" color="textSecondary">
                  Legal
                </AppText>
                {LINKS.map((link, index) => (
                  <React.Fragment key={link.key}>
                    {index > 0 ? <Divider /> : null}
                    <Pressable
                      onPress={open(about.links[link.key])}
                      feedback="opacity"
                      accessibilityRole="link"
                      accessibilityLabel={link.label}
                      style={styles.row}
                    >
                      <HStack align="center" gap="md">
                        <Icon
                          as={link.icon}
                          size="sm"
                          tint={colors.textSecondary}
                        />
                        <AppText variant="body" style={styles.grow}>
                          {link.label}
                        </AppText>
                        <Icon
                          as={ChevronRight}
                          size="sm"
                          color="textTertiary"
                        />
                      </HStack>
                    </Pressable>
                  </React.Fragment>
                ))}
              </VStack>
            </Card>

            <Card radius="xl" padding="base">
              <Pressable
                onPress={open(`mailto:${about.supportEmail}`)}
                feedback="opacity"
                accessibilityRole="link"
                accessibilityLabel={`Email ${about.supportEmail}`}
              >
                <HStack align="center" gap="md">
                  <Icon as={Mail} size="md" tint={colors.primary} />
                  <VStack flex={1} gap="xxs">
                    <AppText variant="bodyStrong">Contact us</AppText>
                    <AppText variant="micro" color="textSecondary">
                      {about.supportEmail}
                    </AppText>
                  </VStack>
                  <Icon as={ChevronRight} size="sm" color="textTertiary" />
                </HStack>
              </Pressable>
            </Card>

            <AppText variant="micro" color="textTertiary" center>
              {`© ${new Date().getFullYear()} ${about.company}`}
            </AppText>
          </>
        )}
      </ScrollView>
    </Screen>
  );
};

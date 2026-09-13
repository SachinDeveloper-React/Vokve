import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SlidersHorizontal } from 'lucide-react-native';
import { AccountMenuRow } from '../../components/account/AccountMenuRow';
import { NotificationFilters } from '../../components/notifications/NotificationFilters';
import { NotificationGroupCard } from '../../components/notifications/NotificationGroupCard';
import { NotificationsHeader } from '../../components/notifications/NotificationsHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useCurrentUser } from '../../stores/authStore';
import {
  useNotificationCounts,
  useNotificationGroups,
  useNotificationsStore,
  type NotificationFilter,
} from '../../stores/notificationsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    empty: { paddingVertical: spacing.xl },
  });

/**
 * The notification centre: what has happened, newest first, under the filter
 * the user chose.
 *
 * The filter is screen state rather than store state — it is a way of looking
 * at the feed, not a fact about it, and a filter that survived into the next
 * visit would greet the user with a list that is missing rows for no reason
 * they can see.
 *
 * Tapping a row marks it read and nothing else: there is nowhere to go yet.
 * That is still worth doing, because the dot here and the one on every
 * header's bell are the same fact, and leaving it set would make the bell lie.
 *
 * It is a root route rather than a page of the Account tab. The bell that opens
 * it is in every header, so filing it under one tab would leave that tab
 * showing a notification list the next time its own icon was tapped. On the
 * root stack it covers the bar and hands the user back to the tab they came
 * from.
 */
export const NotificationsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();

  const [filter, setFilter] = useState<NotificationFilter>('all');
  const counts = useNotificationCounts();
  const groups = useNotificationGroups(filter);
  const markRead = useNotificationsStore(s => s.markRead);

  // A notification tap can open the app straight onto this screen, and
  // `goBack` with nothing behind it is silently a no-op — the chevron would
  // look broken. Home is where the fallback lands: it is the tab the bell is
  // most often pressed from, and the one screen every other route is reachable
  // from.
  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // Names the Account stack's first screen explicitly: the user may have opened
  // this from deep inside that tab, and the avatar means "my account", not
  // "wherever I last was in it".
  const onOpenAccount = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'AccountHome' },
      }),
    [navigation],
  );

  const onOpenSettings = useCallback(
    () => navigation.navigate('NotificationSettings'),
    [navigation],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <NotificationsHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          onPressBack={onPressBack}
          onPressSettings={onOpenSettings}
          onPressAvatar={onOpenAccount}
        />

        <NotificationFilters
          value={filter}
          counts={counts}
          onChange={setFilter}
        />

        {groups.length > 0 ? (
          groups.map(group => (
            <NotificationGroupCard
              key={group.date}
              title={group.title}
              notifications={group.notifications}
              onPressNotification={markRead}
            />
          ))
        ) : (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="Nothing here yet"
              message="When something happens under this filter, it will show up here."
            />
          </Card>
        )}

        <Card radius="xl" padding="base">
          <AccountMenuRow
            icon={SlidersHorizontal}
            tint={colors.primary}
            title="Notification Settings"
            subtitle="Manage your notification preferences"
            onPress={onOpenSettings}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
};

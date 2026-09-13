import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { TimePickerSheet } from '../../components/form/TimePickerSheet';
import { CustomTimesCard } from '../../components/reminders/CustomTimesCard';
import { PresetTimesSection } from '../../components/reminders/PresetTimesSection';
import { ReminderHeader } from '../../components/reminders/ReminderHeader';
import { ReminderHeroCard } from '../../components/reminders/ReminderHeroCard';
import { ReminderPlanCard } from '../../components/reminders/ReminderPlanCard';
import { ReminderSettingsCard } from '../../components/reminders/ReminderSettingsCard';
import { ReminderTipCard } from '../../components/reminders/ReminderTipCard';
import { Screen } from '../../components/ui/Screen';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import {
  REPEAT_DAYS,
  useActiveReminderCount,
  useNextReminderTime,
  useReminderSound,
  useReminderVibration,
  useRemindersEnabled,
  useRemindersInSlot,
  useRemindersStore,
  useRepeatDays,
} from '../../stores/remindersStore';
import { useDailyWaterGoalMl } from '../../stores/settingsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { ReminderSlot } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** The time a picker opens on when the block has nothing to start from. */
const DEFAULT_TIME = '08:00';

/**
 * "Everyday" when the plan runs all week, otherwise the days it does run.
 *
 * Written out rather than shown as "5 days": which days is the thing a user
 * checks, and a count cannot tell them whether the weekend is covered.
 */
function repeatLabelFor(days: number[]): string {
  if (days.length === 7) return 'Everyday';
  if (days.length === 0) return 'Never';
  return [...days]
    .sort((a, b) => a - b)
    .map(day => REPEAT_DAYS[day])
    .join(' ');
}

/**
 * The hydration reminder plan: whether reminders run at all, the times they
 * run at, and how they arrive.
 *
 * Every figure at the top is a count over the same list the sections below
 * edit, so switching a chip off moves the "Reminders ON" figure and the next
 * reminder line in the same frame — which is the only way a settings screen
 * this long stays trustworthy.
 *
 * Nothing here schedules an OS notification yet; the store holds the plan a
 * scheduler will read once the native side lands. That is deliberate rather
 * than missing: the plan is the part the user owns, and it has to survive
 * being set before anything can be scheduled from it.
 */
export const HydrationReminderScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const enabled = useRemindersEnabled();
  const activeCount = useActiveReminderCount();
  const nextTime = useNextReminderTime();
  const morning = useRemindersInSlot('morning');
  const afternoon = useRemindersInSlot('afternoon');
  const evening = useRemindersInSlot('evening');
  const custom = useRemindersInSlot('custom');
  const sound = useReminderSound();
  const vibration = useReminderVibration();
  const repeatDays = useRepeatDays();
  const goalMl = useDailyWaterGoalMl();

  const setEnabled = useRemindersStore(s => s.setEnabled);
  const toggleReminder = useRemindersStore(s => s.toggleReminder);
  const addReminder = useRemindersStore(s => s.addReminder);
  const removeReminder = useRemindersStore(s => s.removeReminder);
  const setVibration = useRemindersStore(s => s.setVibration);
  const toggleRepeatDay = useRemindersStore(s => s.toggleRepeatDay);

  const repeatLabel = useMemo(
    () => repeatLabelFor(repeatDays),
    [repeatDays],
  );

  /** Which block a new time will be added to, and so which sheet is open. */
  const [pickerSlot, setPickerSlot] = useState<ReminderSlot | null>(null);
  /** The custom time whose kebab was tapped. */
  const [menuId, setMenuId] = useState<string | null>(null);

  const openPicker = useCallback((slot: ReminderSlot) => setPickerSlot(slot), []);
  const openCustomPicker = useCallback(() => setPickerSlot('custom'), []);
  const closePicker = useCallback(() => setPickerSlot(null), []);

  const handleAddTime = useCallback(
    (time: string) => {
      addReminder(time, pickerSlot ?? 'custom');
    },
    [addReminder, pickerSlot],
  );

  const closeMenu = useCallback(() => setMenuId(null), []);
  const handleRemove = useCallback(() => {
    if (menuId !== null) {
      removeReminder(menuId);
    }
    setMenuId(null);
  }, [menuId, removeReminder]);

  const menuActions = useMemo(
    () => [
      {
        label: 'Delete reminder',
        destructive: true,
        onPress: handleRemove,
      },
    ],
    [handleRemove],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  const onOpenAccount = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'AccountHome' },
      }),
    [navigation],
  );

  // The sound library and the full preset list have no screens yet. Wired as
  // no-ops rather than left off, so each control keeps the shape it will ship
  // with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ReminderHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <ReminderHeroCard
          enabled={enabled}
          activeCount={activeCount}
          nextTime={nextTime}
          onChange={setEnabled}
        />

        <ReminderPlanCard
          activeCount={activeCount}
          repeatLabel={repeatLabel}
          dailyGoalMl={goalMl}
          nextTime={nextTime}
        />

        <PresetTimesSection
          morning={morning}
          afternoon={afternoon}
          evening={evening}
          onToggle={toggleReminder}
          onPressAdd={openPicker}
          onPressViewAll={notImplemented}
        />

        <CustomTimesCard
          reminders={custom}
          repeatLabel={repeatLabel}
          onToggle={toggleReminder}
          onPressMore={setMenuId}
          onPressAdd={openCustomPicker}
        />

        <ReminderSettingsCard
          sound={sound}
          vibration={vibration}
          repeatDays={repeatDays}
          onPressSound={notImplemented}
          onChangeVibration={setVibration}
          onToggleDay={toggleRepeatDay}
        />

        <ReminderTipCard />
      </ScrollView>

      <TimePickerSheet
        visible={pickerSlot !== null}
        value={DEFAULT_TIME}
        onSubmit={handleAddTime}
        onClose={closePicker}
        title="Add a reminder"
      />

      <ActionSheet
        visible={menuId !== null}
        onClose={closeMenu}
        title="Custom reminder"
        actions={menuActions}
      />
    </Screen>
  );
};

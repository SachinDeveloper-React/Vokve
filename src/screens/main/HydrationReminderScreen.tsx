import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { TimePickerSheet } from '../../components/form/TimePickerSheet';
import { CustomTimesCard } from '../../components/reminders/CustomTimesCard';
import { PresetTimesSection } from '../../components/reminders/PresetTimesSection';
import { ReminderDeliveryCard } from '../../components/reminders/ReminderDeliveryCard';
import { ReminderHeader } from '../../components/reminders/ReminderHeader';
import { ReminderHeroCard } from '../../components/reminders/ReminderHeroCard';
import { ReminderPlanCard } from '../../components/reminders/ReminderPlanCard';
import { ReminderSettingsCard } from '../../components/reminders/ReminderSettingsCard';
import { ReminderTipCard } from '../../components/reminders/ReminderTipCard';
import { useToast } from '../../components/feedback';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { soundLabelFor } from '../../constants/reminderSounds';
import { useTip } from '../../hooks/useContent';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useReminderDelivery } from '../../hooks/useReminderDelivery';
import { useReminderSounds } from '../../hooks/useReminderSounds';
import { logReminderDebug } from '../../services/remindersDebug';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useQuietHours } from '../../stores/notificationSettingsStore';
import { isQuiet } from '../../services/reminderSchedule';
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

/** Stable, so the focus hook does not re-run on every render. */
const reportReminders = () => logReminderDebug('reminder screen opened');

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
 * The plan is the server's (`GET/PUT /hydration/reminders`), so a new phone
 * opens on the same one; until it has answered the screen says it is
 * loading rather than drawing a plan the user never made.
 *
 * Every edit here is scheduled with the OS by `services/reminderScheduler`,
 * which watches the store rather than being called from it — so the screen
 * does not have to know that reminders are rung by local alarms, and the
 * store stays something a test can set without a native module. What the
 * screen does own is saying whether those alarms will actually arrive: the
 * delivery card above the plan is the only place a user can find out before
 * a reminder is missed.
 */
export const HydrationReminderScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const plan = useRemindersStore(s => s.plan);
  const isSyncing = useRemindersStore(s => s.isSyncing);
  const syncError = useRemindersStore(s => s.syncError);
  const hydrateFromServer = useRemindersStore(s => s.hydrateFromServer);
  const refreshIfStale = useRemindersStore(s => s.refreshIfStale);
  const tip = useTip('reminders');
  // The second is the debug report: why a reminder did or did not arrive, to
  // the console, every time this screen opens (dev only). A plan can only be
  // tested by waiting for a minute to pass, so when nothing happens that
  // report is the thing to read.
  useRefreshOnFocus(refreshIfStale, reportReminders);

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
  const sounds = useReminderSounds();
  const delivery = useReminderDelivery();
  const quietHours = useQuietHours();
  const toast = useToast();

  const setEnabled = useRemindersStore(s => s.setEnabled);
  const toggleReminder = useRemindersStore(s => s.toggleReminder);
  const addReminder = useRemindersStore(s => s.addReminder);
  const editReminder = useRemindersStore(s => s.editReminder);
  const removeReminder = useRemindersStore(s => s.removeReminder);
  const setVibration = useRemindersStore(s => s.setVibration);
  const toggleRepeatDay = useRemindersStore(s => s.toggleRepeatDay);

  const repeatLabel = useMemo(
    () => repeatLabelFor(repeatDays),
    [repeatDays],
  );

  // The plan stores the sound's id; the row has to show its name.
  const soundLabel = useMemo(() => soundLabelFor(sound, sounds), [sound, sounds]);

  const onOpenQuietHours = useCallback(
    () => navigation.navigate('NotificationSettings'),
    [navigation],
  );

  /**
   * What the one time sheet is open for: adding a time to a block, or
   * changing one that is already in the plan.
   *
   * One sheet rather than two, because they are the same three columns and
   * the same commit — only what they open on and what the button says
   * differ. An edit carries the time it opened on, so the columns start
   * where the reminder is rather than at 08:00.
   */
  const [picker, setPicker] = useState<
    { mode: 'add'; slot: ReminderSlot } | { mode: 'edit'; id: string; time: string } | null
  >(null);
  /** The custom time whose kebab was tapped. */
  const [menuId, setMenuId] = useState<string | null>(null);

  const openPicker = useCallback(
    (slot: ReminderSlot) => setPicker({ mode: 'add', slot }),
    [],
  );
  const openCustomPicker = useCallback(
    () => setPicker({ mode: 'add', slot: 'custom' }),
    [],
  );
  const closePicker = useCallback(() => setPicker(null), []);

  /** Every time in the plan, so an edit can be opened on the one it is for. */
  const reminders = useRemindersStore(s => s.plan?.reminders);

  /**
   * A chip or a row held down: the same sheet, opened on that time.
   *
   * Looked up here rather than passed up from the component, so the sheet
   * cannot open on a time an edit has already moved — the id is what the
   * plan is keyed by, and the time is read from the plan as it stands.
   */
  const openEditor = useCallback(
    (id: string) => {
      const reminder = reminders?.find(entry => entry.id === id);
      if (!reminder) return;
      setPicker({ mode: 'edit', id, time: reminder.time });
    },
    [reminders],
  );

  /**
   * Said at the moment a time is set, not only on the card above: quiet
   * hours are on by default and start at 22:00, which is exactly when
   * somebody first tries this out. A chip that looks live and never rings is
   * the worst thing this screen can do — and moving a time into the window
   * is as quiet as adding one there.
   */
  const warnIfQuiet = useCallback(
    (time: string) => {
      if (!isQuiet(time, quietHours)) return;
      toast.show({
        title: 'That time is inside your quiet hours',
        message: `Nothing is sent between ${quietHours.start} and ${quietHours.end}, so this one will not ring until you change the window.`,
        tone: 'warning',
        durationMs: 0,
        action: { label: 'Quiet hours', onPress: onOpenQuietHours },
      });
    },
    [onOpenQuietHours, quietHours, toast],
  );

  const handleSubmitTime = useCallback(
    (time: string) => {
      if (picker === null) return;
      if (picker.mode === 'edit') {
        editReminder(picker.id, time);
      } else {
        addReminder(time, picker.slot);
      }
      warnIfQuiet(time);
    },
    [addReminder, editReminder, picker, warnIfQuiet],
  );

  const closeMenu = useCallback(() => setMenuId(null), []);
  const handleEditFromMenu = useCallback(() => {
    if (menuId !== null) {
      openEditor(menuId);
    }
    setMenuId(null);
  }, [menuId, openEditor]);
  const handleRemove = useCallback(() => {
    if (menuId !== null) {
      removeReminder(menuId);
    }
    setMenuId(null);
  }, [menuId, removeReminder]);

  // The kebab carries the same edit as the long press: the gesture is the
  // quick way, and a menu is where somebody looks when they have not found
  // it.
  const menuActions = useMemo(
    () => [
      {
        label: 'Change time',
        onPress: handleEditFromMenu,
      },
      {
        label: 'Delete reminder',
        destructive: true,
        onPress: handleRemove,
      },
    ],
    [handleEditFromMenu, handleRemove],
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

  const onOpenSound = useCallback(
    () => navigation.navigate('ReminderSound'),
    [navigation],
  );

  // The full preset list has no screen yet. Wired as a no-op rather than
  // left off, so the control keeps the shape it will ship with and only the
  // handler changes when its screen lands.
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

        {plan === null ? (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your reminders"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        ) : (
          <>
            <ReminderHeroCard
              enabled={enabled}
              activeCount={activeCount}
              nextTime={nextTime}
              onChange={setEnabled}
            />

            {enabled ? (
              <ReminderDeliveryCard
                allowed={delivery.allowed}
                healthOn={delivery.healthOn}
                exact={delivery.exact}
                scheduled={delivery.scheduled}
                quietCount={delivery.quietCount}
                quietLabel={delivery.quietLabel}
                checking={delivery.checking}
                onAllow={delivery.allow}
                onEnableHealth={delivery.enableHealth}
                onOpenExactAlarms={delivery.openExactAlarms}
                onOpenQuietHours={onOpenQuietHours}
              />
            ) : null}

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
              onEdit={openEditor}
              onPressViewAll={notImplemented}
            />

            <CustomTimesCard
              reminders={custom}
              repeatLabel={repeatLabel}
              onToggle={toggleReminder}
              onPressMore={setMenuId}
              onEdit={openEditor}
              onPressAdd={openCustomPicker}
            />

            <ReminderSettingsCard
              sound={soundLabel}
              vibration={vibration}
              repeatDays={repeatDays}
              onPressSound={onOpenSound}
              onChangeVibration={setVibration}
              onToggleDay={toggleRepeatDay}
            />
          </>
        )}

        {tip ? (
          <ReminderTipCard title={tip.title ?? 'Tip'} message={tip.text} />
        ) : null}
      </ScrollView>

      <TimePickerSheet
        visible={picker !== null}
        value={picker?.mode === 'edit' ? picker.time : DEFAULT_TIME}
        onSubmit={handleSubmitTime}
        onClose={closePicker}
        title={picker?.mode === 'edit' ? 'Change the time' : 'Add a reminder'}
        submitLabel={picker?.mode === 'edit' ? 'Save time' : 'Add time'}
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

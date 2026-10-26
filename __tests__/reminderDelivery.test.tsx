/**
 * Whether the reminders will actually arrive, as the card says it.
 *
 * A reminder plan is the one setting whose whole value is in the future, so
 * the card above it is the only place a member can find out that it will not
 * work before a time passes and nothing happens. What matters is the order:
 * one fault at a time, the most silencing first, and the two that only make
 * a reminder *late* after the ones that stop it arriving at all.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ReminderDeliveryCard } from '../src/components/reminders/ReminderDeliveryCard';
import { ThemeProvider } from '../src/theme';

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const handlers = {
  onAllow: jest.fn(),
  onEnableHealth: jest.fn(),
  onOpenExactAlarms: jest.fn(),
  onOpenQuietHours: jest.fn(),
  onOpenBattery: jest.fn(),
  onOpenPowerManager: jest.fn(),
};

/** Everything in order: the plan is on the phone and nothing is in its way. */
const WORKING = {
  allowed: true,
  healthOn: true,
  exact: true,
  batteryLimited: false,
  hasPowerManager: false,
  scheduled: 9,
  quietCount: 0,
  quietLabel: null,
  checking: false,
  ...handlers,
};

const render = async (props: Partial<typeof WORKING> = {}) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ReminderDeliveryCard {...WORKING} {...props} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

beforeEach(() => {
  Object.values(handlers).forEach(fn => fn.mockClear());
});

describe('ReminderDeliveryCard', () => {
  test('says the plan is on the phone when nothing is in its way', async () => {
    expect(textOf(await render(), RNText)).toContain(
      '9 reminders, even offline',
    );
  });

  test('battery optimisation is raised, with the page that fixes it', async () => {
    const tree = await render({ batteryLimited: true });

    // The usual reason a reminder set for 07:15 arrives at 07:48, and
    // nothing in the plan or the permission says so.
    expect(textOf(tree, RNText)).toContain('Reminders will arrive late');

    press(tree, 'Allow background use');
    expect(handlers.onOpenBattery).toHaveBeenCalledTimes(1);
  });

  test('battery comes before exact alarms: minutes beat however long', async () => {
    const tree = await render({ batteryLimited: true, exact: false });

    const text = textOf(tree, RNText);
    expect(text).toContain('Reminders will arrive late');
    expect(text).not.toContain('a few minutes late');
  });

  test('what silences a reminder outright comes before what makes it late', async () => {
    const quiet = {
      batteryLimited: true,
      exact: false,
      quietCount: 2,
      quietLabel: '22:00–07:00',
    };

    expect(textOf(await render(quiet), RNText)).toContain(
      'times are inside your quiet hours',
    );
    expect(
      textOf(await render({ ...quiet, allowed: false }), RNText),
    ).toContain('Notifications are blocked');
    expect(
      textOf(
        await render({ ...quiet, allowed: false, healthOn: false }),
        RNText,
      ),
    ).toContain('Health reminders are switched off');
  });

  test('inexact alarms are still said, once nothing worse is wrong', async () => {
    const tree = await render({ exact: false });

    expect(textOf(tree, RNText)).toContain('a few minutes late');
    press(tree, 'Allow exact alarms');
    expect(handlers.onOpenExactAlarms).toHaveBeenCalledTimes(1);
  });

  test('a phone with its own background page is offered it, never nagged', async () => {
    const tree = await render({ hasPowerManager: true });

    // There is nothing to read back from that page, so it can never be
    // reported as a fault — it sits under the line that says the plan is
    // working, for the member whose reminders are late anyway.
    const text = textOf(tree, RNText);
    expect(text).toContain('9 reminders, even offline');
    expect(text).toContain('Still arriving late?');

    press(tree, 'Open background settings');
    expect(handlers.onOpenPowerManager).toHaveBeenCalledTimes(1);
  });

  test('a fault hides the page link: one thing to fix at a time', async () => {
    const text = textOf(
      await render({ hasPowerManager: true, batteryLimited: true }),
      RNText,
    );

    expect(text).toContain('Reminders will arrive late');
    expect(text).not.toContain('Still arriving late?');
  });

  test('it says nothing at all while it is still finding out', async () => {
    expect(textOf(await render({ checking: true }), RNText)).toBe('');
  });
});

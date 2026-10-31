/**
 * The invite card the app now carries on ten screens.
 *
 * Every word of it is the server's (`/content/referral-cards`), so what is
 * checked here is that the component states what it was handed and invents
 * nothing: no fallback copy, no reward figure of its own, and no card at all
 * where the operator has not written one.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ReferralPromoCard } from '../src/components/referral/ReferralPromoCard';
import { ThemeProvider, lightColors } from '../src/theme';
import type { ReferralCard } from '../src/types/models';

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const render = async (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const flattenStyle = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') Object.assign(out, value);
  };
  visit(style);
  return out;
};

const card = (patch: Partial<ReferralCard> = {}): ReferralCard => ({
  id: 'home-invite-1',
  screen: 'home',
  title: 'Walk together, earn together',
  message: 'Invite a friend and you each get 20 coins.',
  ctaLabel: 'Invite friends',
  accent: 'brand',
  position: 'bottom',
  emoji: '🤝',
  inviterCoins: 20,
  inviteeCoins: 20,
  ...patch,
});

describe('ReferralPromoCard', () => {
  test('states the words the server sent, and no others', async () => {
    const text = allText(await render(<ReferralPromoCard card={card()} onPress={() => {}} />));

    expect(text).toContain('Walk together, earn together');
    expect(text).toContain('Invite a friend and you each get 20 coins.');
    expect(text).toContain('Invite friends');
    expect(text).toContain('EARN 20 COINS');
  });

  test('a campaign can change every word of it without an app release', async () => {
    const text = allText(
      await render(
        <ReferralPromoCard
          card={card({
            title: 'Double up this Diwali',
            message: 'Bring a friend and take 40 coins each.',
            ctaLabel: 'Share now',
            inviterCoins: 40,
          })}
          onPress={() => {}}
        />,
      ),
    );

    expect(text).toContain('Double up this Diwali');
    expect(text).toContain('Share now');
    expect(text).toContain('EARN 40 COINS');
    // Nothing of the app's own wording survives into the card.
    expect(text).not.toContain('Walk together');
    expect(text).not.toContain('Invite friends');
  });

  test('draws nothing at all where the operator has written no card', async () => {
    const tree = await render(<ReferralPromoCard card={null} onPress={() => {}} />);

    // No words and nothing to press: not an empty panel holding a gap open
    // in the column, which is what a card drawn without content would be.
    expect(allText(tree)).toBe('');
    expect(
      tree.root.findAll(n => n.props?.accessibilityRole === 'button'),
    ).toHaveLength(0);
  });

  test('the accent is a name the app resolves, so the server never sends a colour', async () => {
    const gold = await render(
      <ReferralPromoCard card={card({ accent: 'gold' })} onPress={() => {}} />,
    );
    const success = await render(
      <ReferralPromoCard card={card({ accent: 'success' })} onPress={() => {}} />,
    );

    const tints = (tree: ReactTestRenderer.ReactTestRenderer) =>
      tree.root
        .findAll(n => typeof n.props?.color === 'string')
        .map(n => n.props.color as string);

    expect(tints(gold)).toContain(lightColors.gold);
    expect(tints(success)).toContain(lightColors.success);
  });

  test('a card with no reward on it drops the pill rather than promising zero', async () => {
    const text = allText(
      await render(
        <ReferralPromoCard
          card={card({ inviterCoins: 0, message: 'Bring a friend along.' })}
          onPress={() => {}}
        />,
      ),
    );

    expect(text).toContain('Bring a friend along.');
    expect(text).not.toContain('EARN 0 COINS');
    expect(text).not.toContain('EARN');
  });

  test('the words are inked to suit the accent, never fixed to white', async () => {
    // The accents are not all the same weight and they change weight between
    // the themes, so a banner that fills itself with one cannot pick its text
    // colour once: gold would be read against white at a glance and lost.
    const inkOf = async (accent: ReferralCard['accent']) => {
      const tree = await render(
        <ReferralPromoCard card={card({ accent })} onPress={() => {}} />,
      );
      return tree.root
        .findAllByType(RNText)
        .map(n => flattenStyle(n.props.style).color)
        .filter((value): value is string => typeof value === 'string');
    };

    // `primary` is dark enough to carry light text; `gold` is not.
    expect(await inkOf('primary')).toContain('rgba(248, 250, 252, 1)');
    expect(await inkOf('gold')).toContain('rgba(15, 23, 42, 1)');
  });

  test('only the anchor the card asks for draws it', async () => {
    // Every screen renders all three, so moving the banner up the page is a
    // field on the row rather than a change in the screen.
    const drawn = async (position: ReferralCard['position'], at: ReferralCard['position']) =>
      allText(
        await render(
          <ReferralPromoCard card={card({ position })} at={at} onPress={() => {}} />,
        ),
      );

    expect(await drawn('middle', 'middle')).toContain('Walk together');
    expect(await drawn('middle', 'top')).toBe('');
    expect(await drawn('middle', 'bottom')).toBe('');
    expect(await drawn('top', 'top')).toContain('Walk together');
  });

  test('an anchor left unnamed is the foot of the scroll', async () => {
    // Which is where a server from before positions shipped puts every card.
    const tree = await render(
      <ReferralPromoCard card={card({ position: 'bottom' })} onPress={() => {}} />,
    );

    expect(allText(tree)).toContain('Walk together');
  });

  test('the whole card is the tap target, and it says where it goes', async () => {
    const onPress = jest.fn();
    const tree = await render(<ReferralPromoCard card={card()} onPress={onPress} />);

    const pressable = tree.root
      .findAll(
        n =>
          typeof n.props?.accessibilityLabel === 'string' &&
          typeof n.props?.onPress === 'function',
      )
      .find(n => (n.props.accessibilityLabel as string).startsWith('Walk together'));

    expect(pressable).toBeTruthy();
    expect(pressable!.props.accessibilityHint).toBe('Invite friends');
    ReactTestRenderer.act(() => pressable!.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

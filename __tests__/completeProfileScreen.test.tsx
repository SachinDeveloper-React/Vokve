/**
 * Onboarding's job is to collect the few things sign-up does not, and then get
 * out of the way. These checks pin the parts that are easy to get subtly
 * wrong: that it does not ask again for what sign-up already took, that a unit
 * switch converts rather than discards what was typed, and that what reaches
 * the server is in the canonical units the model stores.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { CompleteProfileScreen } from '../src/screens/onboarding/CompleteProfileScreen';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const completeProfile = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  completeProfile.mockClear();
  completeProfile.mockResolvedValue(true);
  useAuthStore.setState({ completeProfile, isSubmitting: false, error: null });
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <CompleteProfileScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const pressableFor = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function')!;

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  await ReactTestRenderer.act(async () => {
    await pressableFor(tree, label).props.onPress();
  });
};

/**
 * Types into the text fields by position.
 *
 * In metric those are name, height, weight. In imperial the height stops being
 * a text field at all — it becomes a picker — so there are only two.
 */
const fill = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  values: (string | null)[],
) => {
  const inputs = tree.root.findAllByType(TextInput);
  await ReactTestRenderer.act(() => {
    values.forEach((value, index) => {
      if (value !== null) {
        inputs[index].props.onChangeText(value);
      }
    });
  });
};

/** Walks the imperial height sheet: open, choose feet and inches, confirm. */
const pickHeight = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  feet: number,
  inches: number,
) => {
  await press(tree, 'Height');
  await press(tree, `Feet ${feet}`);
  await press(tree, `Inches ${inches}`);
  await press(tree, 'Done');
};

/** A TextInput's value is always a string, whatever the field models. */
const valueOf = (tree: ReactTestRenderer.ReactTestRenderer, index: number) =>
  tree.root.findAllByType(TextInput)[index].props.value as string;

describe('complete profile screen', () => {
  test('asks only for what sign-up did not already collect', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);

    expect(text).toContain('Complete Your Profile');
    expect(text).toContain('Full Name');
    expect(text).toContain('Height');
    expect(text).toContain('Weight');
    // Both were taken during sign-up; asking again reads as having lost them.
    expect(text).not.toContain('Gender');
    expect(text).not.toContain('Date of Birth');
  });

  test('starts in metric', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);

    expect(text).toContain('cm');
    expect(text).toContain('kg');
  });

  test('sends the figures in the units the model stores', async () => {
    const tree = await render();

    await fill(tree, ['Rahul Sharma', '175', '68']);
    await press(tree, 'Continue');

    expect(completeProfile).toHaveBeenCalledWith({
      name: 'Rahul Sharma',
      heightCm: 175,
      weightKg: 68,
      units: 'metric',
    });
  });

  test('switching units converts what is typed rather than clearing it', async () => {
    const tree = await render();

    await fill(tree, ['Rahul Sharma', '175', '68']);
    await press(tree, 'Unit: cm');

    const text = textOf(tree, RNText);
    // 175 cm is 68.9 inches, which reads as 5'9" — not as a number to retype.
    expect(text).toContain('ft/in');
    expect(text).toContain(`5' 9"`);
    // Weight is still typed, and keeps its converted figure.
    expect(valueOf(tree, 1)).toBe('149.9'); // 68 kg
  });

  test('picks an imperial height in feet and inches, never in bare inches', async () => {
    const tree = await render();

    await press(tree, 'Unit: cm');
    await pickHeight(tree, 5, 9);

    expect(textOf(tree, RNText)).toContain(`5' 9"`);
  });

  test('converts a picked imperial height back to centimetres', async () => {
    const tree = await render();

    await press(tree, 'Unit: cm');
    await pickHeight(tree, 5, 9);
    await fill(tree, ['Rahul Sharma', '150']);
    await press(tree, 'Continue');

    expect(completeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        heightCm: 175.3, // 69 inches
        weightKg: 68, // 150 lb
        units: 'imperial',
      }),
    );
  });

  test('switching back to metric keeps the picked height', async () => {
    const tree = await render();

    await press(tree, 'Unit: cm');
    await pickHeight(tree, 5, 9);
    await press(tree, 'Unit: ft/in');

    expect(textOf(tree, RNText)).toContain('cm');
    expect(valueOf(tree, 1)).toBe('175.3');
  });

  test('blocks submission and says what is missing', async () => {
    const tree = await render();

    await press(tree, 'Continue');

    expect(completeProfile).not.toHaveBeenCalled();
    const text = textOf(tree, RNText);
    expect(text).toContain('Enter your full name');
    expect(text).toContain('Enter your height');
    expect(text).toContain('Enter your weight');
  });

  test('rejects figures no human could have', async () => {
    const tree = await render();

    await fill(tree, ['Rahul Sharma', '17', '68']);
    await press(tree, 'Continue');

    expect(completeProfile).not.toHaveBeenCalled();
    expect(textOf(tree, RNText)).toContain('those look off');
  });

  test('keeps digits and one decimal, nothing else', async () => {
    const tree = await render();

    await fill(tree, ['Rahul', '17a5.678', '68']);

    expect(valueOf(tree, 1)).toBe('175.6');
  });
});

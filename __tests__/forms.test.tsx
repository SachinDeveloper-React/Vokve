/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Checkbox } from '../src/components/form/Checkbox';
import { RadioGroup } from '../src/components/form/Radio';
import { FormInput, FormCheckbox } from '../src/components/form/fields';
import { ThemeProvider } from '../src/theme';
import { SegmentedControl } from '../src/components/form/SegmentedControl';
import {
  signInSchema,
  signUpSchema,
  toSignUpPayload,
} from '../src/types/forms';

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
  collectText(tree, Text);

const findByLabel = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

describe('sign-in schema', () => {
  test('rejects an empty identifier with a usable message', () => {
    const result = signInSchema.safeParse({ identifier: '', password: 'x' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe(
      'Enter your email or phone number',
    );
  });

  test('rejects an identifier that is neither an email nor a phone number', () => {
    const result = signInSchema.safeParse({ identifier: 'nope', password: 'x' });
    expect(result.error!.issues[0].message).toContain('email address');
  });

  test('accepts a valid email', () => {
    expect(
      signInSchema.safeParse({ identifier: 'a@b.com', password: 'secret' })
        .success,
    ).toBe(true);
  });

  test('accepts a phone number, formatted or not', () => {
    for (const identifier of ['9876543210', '+91 98765 43210', '+1-555-0138']) {
      expect(
        signInSchema.safeParse({ identifier, password: 'secret' }).success,
      ).toBe(true);
    }
  });
});

describe('sign-up schema', () => {
  const valid = {
    email: 'a@b.com',
    phone: { country: 'IN', number: '9876543210' },
    password: 'longenough1',
    confirmPassword: 'longenough1',
    dateOfBirth: '1995-04-17',
    gender: 'female' as const,
    acceptedTerms: true,
  };

  test('accepts a complete form', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  test('requires a phone number of a believable length', () => {
    for (const number of ['', '12345']) {
      const result = signUpSchema.safeParse({
        ...valid,
        phone: { ...valid.phone, number },
      });
      expect(result.success).toBe(false);
      expect(result.error!.issues.some(i => i.path[0] === 'phone')).toBe(true);
    }
  });

  test('rejects a country that is not on the list', () => {
    const result = signUpSchema.safeParse({
      ...valid,
      phone: { country: 'ZZ', number: '9876543210' },
    });
    expect(result.success).toBe(false);
  });

  test('requires a date of birth in ISO form', () => {
    for (const dateOfBirth of ['', '17/04/1995']) {
      const result = signUpSchema.safeParse({ ...valid, dateOfBirth });
      expect(result.error!.issues[0].message).toBe('Select your date of birth');
    }
  });

  test('requires a gender to have been chosen', () => {
    const result = signUpSchema.safeParse({ ...valid, gender: null });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some(i => i.path[0] === 'gender')).toBe(true);
  });

  test('requires the password to mix letters and numbers', () => {
    const lettersOnly = signUpSchema.safeParse({
      ...valid,
      password: 'lettersonly',
      confirmPassword: 'lettersonly',
    });
    expect(lettersOnly.error!.issues[0].message).toBe(
      'Include at least one number',
    );

    const digitsOnly = signUpSchema.safeParse({
      ...valid,
      password: '12345678',
      confirmPassword: '12345678',
    });
    expect(digitsOnly.error!.issues[0].message).toBe(
      'Include at least one letter',
    );
  });

  test('maps parsed values onto the request payload', () => {
    const payload = toSignUpPayload(signUpSchema.parse({
      ...valid,
      email: '  Sachin@Example.COM ',
    }));

    // The dial code is joined on, and the form's own bookkeeping is dropped.
    expect(payload).toEqual({
      email: 'sachin@example.com',
      phone: '+919876543210',
      password: 'longenough1',
      dateOfBirth: '1995-04-17',
      gender: 'female',
    });
  });

  test('reports a password mismatch on the confirm field, not the root', () => {
    const result = signUpSchema.safeParse({
      ...valid,
      confirmPassword: 'different',
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues.find(i => i.message === 'Passwords do not match');
    // The message has to land under the field the user must fix.
    expect(issue?.path).toEqual(['confirmPassword']);
  });

  test('requires the terms checkbox', () => {
    const result = signUpSchema.safeParse({ ...valid, acceptedTerms: false });
    expect(result.success).toBe(false);
    expect(
      result.error!.issues.some(i => i.path[0] === 'acceptedTerms'),
    ).toBe(true);
  });

  test('rejects a short password', () => {
    const result = signUpSchema.safeParse({
      ...valid,
      password: 'shor1',
      confirmPassword: 'shor1',
    });
    expect(result.error!.issues[0].message).toBe('Use at least 8 characters');
  });
});

describe('SegmentedControl', () => {
  const segments = [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'other', label: 'Other' },
  ];

  test('marks only the chosen segment', async () => {
    const tree = await render(
      <SegmentedControl
        label="Gender"
        segments={segments}
        value="female"
        onChange={() => {}}
      />,
    );

    expect(findByLabel(tree, 'Female')!.props.accessibilityState.selected).toBe(
      true,
    );
    expect(findByLabel(tree, 'Male')!.props.accessibilityState.selected).toBe(
      false,
    );
  });

  test('reports the value that was pressed', async () => {
    const onChange = jest.fn();
    const tree = await render(
      <SegmentedControl segments={segments} value={null} onChange={onChange} />,
    );

    await ReactTestRenderer.act(() => findByLabel(tree, 'Other')!.props.onPress());
    expect(onChange).toHaveBeenCalledWith('other');
  });
});

describe('Checkbox', () => {
  test('reports its checked state to assistive tech', async () => {
    const tree = await render(
      <Checkbox checked onChange={() => {}} label="Accept" />,
    );
    expect(findByLabel(tree, 'Accept')!.props.accessibilityState.checked).toBe(
      true,
    );
  });

  test('toggles away from its current value', async () => {
    const onChange = jest.fn();
    const tree = await render(
      <Checkbox checked={false} onChange={onChange} label="Accept" />,
    );

    await ReactTestRenderer.act(() => findByLabel(tree, 'Accept')!.props.onPress());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('RadioGroup', () => {
  test('marks only the selected option', async () => {
    const tree = await render(
      <RadioGroup
        label="Units"
        value="metric"
        onChange={() => {}}
        options={[
          { value: 'metric', label: 'Metric' },
          { value: 'imperial', label: 'Imperial' },
        ]}
      />,
    );

    expect(findByLabel(tree, 'Metric')!.props.accessibilityState.selected).toBe(true);
    expect(findByLabel(tree, 'Imperial')!.props.accessibilityState.selected).toBe(false);
  });
});

describe('react-hook-form integration', () => {
  const Harness = ({ onValid }: { onValid: jest.Mock }) => {
    const { control, handleSubmit } = useForm({
      resolver: zodResolver(signInSchema),
      defaultValues: { identifier: '', password: '' },
      mode: 'onBlur',
    });

    // Wrapped: RHF's handler is typed for a DOM SyntheticEvent, which RN's
    // press event does not satisfy.
    const submit = () => {
      handleSubmit(onValid)();
    };

    return (
      <>
        <FormInput control={control} name="identifier" label="Email" />
        <FormInput control={control} name="password" label="Password" />
        <Text accessibilityLabel="submit" onPress={submit}>
          Submit
        </Text>
      </>
    );
  };

  const submitOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.find(n => n.props?.accessibilityLabel === 'submit');

  test('surfaces zod messages under the offending field', async () => {
    const onValid = jest.fn();
    const tree = await render(<Harness onValid={onValid} />);

    await ReactTestRenderer.act(async () => {
      await submitOf(tree).props.onPress();
    });

    expect(onValid).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Enter your email or phone number');
  });

  test('submits the typed values once they validate', async () => {
    const onValid = jest.fn();
    const tree = await render(<Harness onValid={onValid} />);

    const inputs = tree.root.findAllByType(TextInput);
    await ReactTestRenderer.act(() => {
      inputs[0].props.onChangeText('a@b.com');
      inputs[1].props.onChangeText('secret');
    });

    await ReactTestRenderer.act(async () => {
      await submitOf(tree).props.onPress();
    });

    expect(onValid).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'a@b.com', password: 'secret' }),
      undefined,
    );
  });

  test('a checkbox field round-trips through the form state', async () => {
    const onValid = jest.fn();

    const CheckHarness = () => {
      const { control, handleSubmit } = useForm({
        resolver: zodResolver(signUpSchema),
        defaultValues: {
          email: 'a@b.com',
          phone: { country: 'IN', number: '9876543210' },
          password: 'longenough1',
          confirmPassword: 'longenough1',
          dateOfBirth: '1995-04-17',
          gender: 'female' as const,
          acceptedTerms: false,
        },
      });
      const submit = () => {
        handleSubmit(onValid)();
      };

      return (
        <>
          <FormCheckbox control={control} name="acceptedTerms" label="Accept" />
          <Text accessibilityLabel="submit" onPress={submit}>
            Submit
          </Text>
        </>
      );
    };

    const tree = await render(<CheckHarness />);

    // Unchecked: the schema must block it.
    await ReactTestRenderer.act(async () => {
      await submitOf(tree).props.onPress();
    });
    expect(onValid).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('accept the terms');

    await ReactTestRenderer.act(() => findByLabel(tree, 'Accept')!.props.onPress());
    await ReactTestRenderer.act(async () => {
      await submitOf(tree).props.onPress();
    });
    expect(onValid).toHaveBeenCalled();
  });
});

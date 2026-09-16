/**
 * The address book decides where a physical reward goes, so the checks here
 * are about not sending it to the wrong door: that the default is marked and
 * can be moved, that a delete asks first, that the checkout's "choose" mood
 * makes a tap the default and leaves, and that the form refuses a PIN the
 * courier could not use before anything reaches the server.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AddressesScreen } from '../src/screens/main/AddressesScreen';
import { AddressFormScreen } from '../src/screens/main/AddressFormScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useAddressesStore } from '../src/stores/addressesStore';
import { useAuthStore } from '../src/stores/authStore';
import type { Address } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
    addListener: jest.fn(() => jest.fn()),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  addressApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  },
  orderApi: {
    list: jest.fn(),
    get: jest.fn(),
    count: jest.fn(),
    cancel: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  shopApi: { items: jest.fn(), item: jest.fn(), redeem: jest.fn() },
  notificationApi: {
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const { addressApi } = jest.requireMock('../src/services/api/endpoints') as {
  addressApi: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    setDefault: jest.Mock;
    remove: jest.Mock;
  };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const address = (id: string, label: string, isDefault: boolean): Address => ({
  id,
  label,
  name: 'Asha Verma',
  phone: '+919876543210',
  line1: '12 MG Road',
  line2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  country: 'IN',
  isDefault,
});

let book: Address[] = [];

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  book = [
    address('adr-home', 'Home', true),
    address('adr-office', 'Office', false),
  ];
  // The mock keeps a book, so the screen's re-fetch after a write sees the write.
  addressApi.list.mockReset().mockImplementation(async () => book);
  addressApi.setDefault.mockReset().mockImplementation(async (id: string) => {
    book = book.map(a => ({ ...a, isDefault: a.id === id }));
    return book.find(a => a.id === id);
  });
  addressApi.remove.mockReset().mockImplementation(async (id: string) => {
    book = book.filter(a => a.id !== id);
    if (book.length && !book.some(a => a.isDefault))
      book[0] = { ...book[0], isDefault: true };
    return { ok: true };
  });
  addressApi.create
    .mockReset()
    .mockImplementation(async (input: Omit<Address, 'id'>) => {
      const created = { ...input, id: 'adr-new' };
      book = [created, ...book];
      return created;
    });
  addressApi.update.mockReset();
  useAddressesStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
});

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
});

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const render = async (screen: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>{screen}</ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  await settle();
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

/**
 * Presses a button by label — inside the card for `addressId` when given,
 * since every card carries the same "Edit" and "Delete".
 */
const pressButton = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  addressId?: string,
) => {
  const scope = addressId
    ? tree.root.findAll(n => n.props?.address?.id === addressId)[0]
    : tree.root;
  const node = scope
    ?.findAll(
      n => n.props?.label === label && typeof n.props.onPress === 'function',
    )
    .at(-1);
  if (!node) throw new Error(`No button labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

describe('AddressesScreen', () => {
  test('fetches the book on open and marks the default', async () => {
    const tree = await render(<AddressesScreen />);

    expect(addressApi.list).toHaveBeenCalled();
    const text = allText(tree);
    expect(text).toContain('Home');
    expect(text).toContain('Office');
    expect(text).toContain('Default');
    // Only the non-default offers to become it.
    expect(
      tree.root.findAll(n => n.props?.label === 'Make default').length,
    ).toBeGreaterThan(0);
  });

  test('"Make default" moves the default and re-reads the book', async () => {
    const tree = await render(<AddressesScreen />);

    await pressButton(tree, 'Make default', 'adr-office');

    expect(addressApi.setDefault).toHaveBeenCalledWith('adr-office');
    expect(
      useAddressesStore.getState().addresses.find(a => a.isDefault)?.id,
    ).toBe('adr-office');
  });

  test('deleting asks first; the survivor inherits the default', async () => {
    const tree = await render(<AddressesScreen />);

    await pressButton(tree, 'Delete', 'adr-home'); // the default
    expect(addressApi.remove).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Another address will take its place.');

    await press(tree, 'Remove this address');

    expect(addressApi.remove).toHaveBeenCalledWith('adr-home');
    const remaining = useAddressesStore.getState().addresses;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: 'adr-office', isDefault: true });
  });

  test('in choose mode, tapping an address makes it the default and goes back', async () => {
    mockRouteParams = { select: true };
    const tree = await render(<AddressesScreen />);
    expect(allText(tree)).toContain('Deliver to');

    await press(tree, 'Deliver to Office, Asha Verma');

    expect(addressApi.setDefault).toHaveBeenCalledWith('adr-office');
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('an empty book leads straight to the form', async () => {
    book = [];
    const tree = await render(<AddressesScreen />);

    expect(allText(tree)).toContain('No addresses yet');
    await pressButton(tree, 'Add an address');
    expect(mockNavigate).toHaveBeenCalledWith('AddressForm');
  });
});

describe('AddressFormScreen', () => {
  /** Types into the field with the given accessibility label. */
  const type = async (
    tree: ReactTestRenderer.ReactTestRenderer,
    label: string,
    value: string,
  ) => {
    const input = tree.root
      .findAll(
        n =>
          n.props?.accessibilityLabel === label &&
          typeof n.props.onChangeText === 'function',
      )
      .at(-1);
    if (!input) throw new Error(`No input labelled "${label}"`);
    await ReactTestRenderer.act(async () => {
      input.props.onChangeText(value);
    });
  };

  const fill = async (
    tree: ReactTestRenderer.ReactTestRenderer,
    postalCode: string,
  ) => {
    await type(tree, 'Address label', 'Gym');
    await type(tree, 'Recipient name', 'Asha Verma');
    await type(tree, 'Phone number for the courier', '+91 98765 43210');
    await type(tree, 'Address line 1', '4 Cunningham Road');
    await type(tree, 'City', 'Bengaluru');
    await type(tree, 'PIN code', postalCode);
    await type(tree, 'State', 'Karnataka');
  };

  test('a PIN the courier could not use is refused before the server is asked', async () => {
    book = [];
    const tree = await render(<AddressFormScreen />);
    await fill(tree, '12');

    await pressButton(tree, 'Save address');

    expect(addressApi.create).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Enter the 6-digit PIN code');
  });

  test('a complete address is saved with the country, and the screen goes back', async () => {
    book = [];
    const tree = await render(<AddressFormScreen />);
    await fill(tree, '560052');

    await pressButton(tree, 'Save address');

    expect(addressApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Gym',
        postalCode: '560052',
        country: 'IN',
        isDefault: true,
      }),
    );
    expect(mockGoBack).toHaveBeenCalled();
    expect(useAddressesStore.getState().addresses[0]).toMatchObject({
      id: 'adr-new',
      label: 'Gym',
    });
  });

  test('editing starts from the saved values and sends the changes', async () => {
    useAddressesStore.setState({ addresses: book });
    mockRouteParams = { id: 'adr-office' };
    addressApi.update.mockImplementation(
      async (id: string, patch: Partial<Address>) => {
        book = book.map(a => (a.id === id ? { ...a, ...patch } : a));
        return book.find(a => a.id === id);
      },
    );
    const tree = await render(<AddressFormScreen />);
    expect(allText(tree)).toContain('Edit address');

    await type(tree, 'City', 'Mysuru');
    await pressButton(tree, 'Save changes');

    expect(addressApi.update).toHaveBeenCalledWith(
      'adr-office',
      expect.objectContaining({ city: 'Mysuru', label: 'Office' }),
    );
    expect(mockGoBack).toHaveBeenCalled();
  });
});

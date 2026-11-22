/**
 * Uploaded avatars did not show on Android while iOS showed them. The API
 * wrote `http://localhost:3000/v1/media/...`, and on an Android phone
 * localhost is the phone. These checks cover three things: a development
 * build loads the API's own media from the address it reaches the API at;
 * a failed photo does not leave the frame empty for the next one; and an
 * avatar whose photo fails falls back to initials.
 *
 * @format
 */

import React from 'react';
import { Image, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AppImage } from '../src/components/media/AppImage';
import { Avatar } from '../src/components/media/Avatar';
import { mediaUri } from '../src/services/api/mediaUri';
import { ThemeProvider } from '../src/theme';

// What an Android development build talks to (LOCAL_API_HOST).
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    apiBaseUrl: 'http://10.20.38.237:3000/v1',
  },
}));

const STORED = 'http://localhost:3000/v1/media/avatars/avt_1';
const ON_PHONE = 'http://10.20.38.237:3000/v1/media/avatars/avt_1';

const render = async (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
};

const imageOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Image)[0];

const textIn = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .join(' ');

describe('mediaUri', () => {
  test("moves the API's own media onto the address this build reaches the API at", () => {
    expect(mediaUri(STORED)).toBe(ON_PHONE);
    // A photo stored while the Mac had another LAN address still loads.
    expect(
      mediaUri('http://192.168.0.112:3000/v1/media/avatars/avt_2?v=3'),
    ).toBe('http://10.20.38.237:3000/v1/media/avatars/avt_2?v=3');
  });

  test('leaves images the API does not serve alone', () => {
    const google = 'https://lh3.googleusercontent.com/a/abc=s96-c';
    const cdn = 'https://cdn.example.com/products/p1.webp';
    expect(mediaUri(google)).toBe(google);
    expect(mediaUri(cdn)).toBe(cdn);
  });

  test('a release build loads the URL exactly as the server wrote it', () => {
    const g = globalThis as { __DEV__?: boolean };
    const before = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(mediaUri(STORED)).toBe(STORED);
    } finally {
      g.__DEV__ = before;
    }
  });
});

describe('AppImage', () => {
  test('asks the Image for the rewritten address', async () => {
    const tree = await render(<AppImage uri={STORED} width={40} height={40} />);
    expect(imageOf(tree).props.source).toEqual({ uri: ON_PHONE });
  });

  test('a failed photo does not keep the next one from showing', async () => {
    const tree = await render(
      <AppImage
        uri={STORED}
        width={40}
        height={40}
        fallback={<Text>fallback</Text>}
      />,
    );
    await ReactTestRenderer.act(() => imageOf(tree).props.onError());
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(textIn(tree)).toContain('fallback');

    // The member uploads another photo: the server hands back a new id.
    await ReactTestRenderer.act(() => {
      tree.update(
        <ThemeProvider>
          <AppImage
            uri="http://localhost:3000/v1/media/avatars/avt_2"
            width={40}
            height={40}
            fallback={<Text>fallback</Text>}
          />
        </ThemeProvider>,
      );
    });
    expect(imageOf(tree).props.source).toEqual({
      uri: 'http://10.20.38.237:3000/v1/media/avatars/avt_2',
    });
  });
});

describe('Avatar', () => {
  test('shows the initials when the photo will not load', async () => {
    const tree = await render(<Avatar name="Sachin Kumar" uri={STORED} />);
    expect(textIn(tree)).not.toContain('SK');

    await ReactTestRenderer.act(() => imageOf(tree).props.onError());
    expect(textIn(tree)).toContain('SK');
  });
});

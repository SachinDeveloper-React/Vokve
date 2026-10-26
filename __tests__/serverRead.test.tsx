/**
 * Reading the server's figures when the server cannot be reached.
 *
 * The app counts steps on the phone but shows the part the server verified,
 * so eleven screens are a server read and nothing else. Those answers used
 * to live in a plain in-memory map: fine for reopening a screen a minute
 * later, empty on every cold start. An app opened with no network therefore
 * had no figures at all — for data it had already been told, about steps
 * that were on the device the whole time.
 *
 * So the checks here are the three things that makes true: an answer
 * survives the process, a failed read never clears what is on screen, and
 * the next account on the phone sees none of the last one's.
 *
 * @format
 */

import React, { useEffect } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  clearServerReads,
  entriesFromStored,
  useServerRead,
  type Loaded,
} from '../src/hooks/useServerRead';
import { getMMKV } from '../src/stores';

/** The key the cache is written under, as the hook writes it. */
const STORAGE_KEY = 'vokve.reads';

interface Figures {
  steps: number;
}

/** Renders the hook and hands its latest value back through a box. */
const Probe = ({
  readKey,
  read,
  out,
}: {
  readKey: string | null;
  read: () => Promise<Figures>;
  out: { current: Loaded<Figures> | null };
}) => {
  const loaded = useServerRead(readKey, read);
  useEffect(() => {
    out.current = loaded;
  });
  return null;
};

/**
 * Waits out the hook's debounced write to storage. The resolver is wrapped
 * rather than passed to `setTimeout` directly, because React Native types
 * that callback as taking no arguments and a bare resolver is not one.
 */
const waitFor = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(() => resolve(), ms);
  });

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

/**
 * Mounts the hook for one question. A second call with the same key is the
 * cold start: module state is all that carries an answer between them, and
 * the point of the cache is that it does not have to.
 */
const mount = async (readKey: string | null, read: () => Promise<Figures>) => {
  const out: { current: Loaded<Figures> | null } = { current: null };
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <Probe readKey={readKey} read={read} out={out} />,
    );
    await Promise.resolve();
  });
  await settle();
  return () => {
    if (!out.current) throw new Error('Hook has not rendered');
    return out.current;
  };
};

beforeEach(() => {
  clearServerReads();
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

test('an answer outlives the process, so a cold start has figures', async () => {
  const read = jest.fn().mockResolvedValue({ steps: 7431 });
  const online = await mount('day:2026-10-23', read);
  expect(online().data).toEqual({ steps: 7431 });

  // What a relaunch has: the hook's in-memory map is gone with the process,
  // and this is all that is left of the answer.
  await waitFor(500);
  expect(getMMKV().getString(STORAGE_KEY)).toContain('7431');

  // Asked again, it paints before the network is touched — which is what an
  // offline launch sees. Dated too, because a step count with no date on it
  // stops being true the moment it is out of date.
  const again = await mount('day:2026-10-23', read);
  expect(again().data).toEqual({ steps: 7431 });
  expect(again().cachedAt).not.toBeNull();
});

test('a failed read leaves the figures up and says they are stale', async () => {
  const read = jest
    .fn<Promise<Figures>, []>()
    .mockResolvedValueOnce({ steps: 3200 })
    .mockRejectedValue(new Error('Network request failed'));

  const online = await mount('day:2026-10-22', read);
  expect(online().data).toEqual({ steps: 3200 });
  // This session's own answer: nothing to warn about.
  expect(online().isStale).toBe(false);

  const offline = await mount('day:2026-10-22', read);

  // The error is reported *beside* the data rather than instead of it: the
  // screen shows the figures it has and dates them, where it used to replace
  // a real step count with "Couldn't load".
  expect(offline().error).not.toBeNull();
  expect(offline().data).toEqual({ steps: 3200 });
  expect(offline().isStale).toBe(true);
  expect(offline().cachedAt).not.toBeNull();
});

test('nothing is invented for a question that has never been answered', async () => {
  const read = jest
    .fn<Promise<Figures>, []>()
    .mockRejectedValue(new Error('Network request failed'));
  const loaded = await mount('day:never-asked', read);

  expect(loaded().error).not.toBeNull();
  // A zero or an empty list would read as the member's real figures.
  expect(loaded().data).toBeNull();
  expect(loaded().isStale).toBe(false);
  expect(loaded().cachedAt).toBeNull();
});

test('signing out takes the stored answers with it', async () => {
  const read = jest.fn().mockResolvedValue({ steps: 9999 });
  const loaded = await mount('day:2026-10-21', read);
  expect(loaded().data).not.toBeNull();
  await waitFor(500);
  expect(getMMKV().getString(STORAGE_KEY)).toContain('9999');

  // These answers outlive the process now, so forgetting the stored half
  // would be one person's figures shown to the next on the same phone.
  clearServerReads();
  expect(getMMKV().getString(STORAGE_KEY) ?? null).toBeNull();

  const after = await mount(
    'day:2026-10-21',
    () => new Promise<Figures>(() => {}),
  );
  expect(after().data).toBeNull();
});

/**
 * A cache is the one place yesterday's contract can reach today's code.
 *
 * The schemas are parsed on the way *in*, so a field added to a response
 * gets its default on a fresh read and is simply **absent** from an answer
 * written before it existed — and a screen that renders that field crashes
 * on a payload nothing validated. `WeeklyResultsCard` did exactly that, on
 * `perks.length`, against a stored answer from the build before it. So a
 * blob is stamped with the build that wrote it, and only that build reads
 * it back.
 */
describe('what the stored blob is allowed to be', () => {
  const entry = { at: new Date().toISOString(), data: { steps: 4242 } };

  /** What the hook itself writes, read back as entries. */
  const roundTrip = async () => {
    clearServerReads();
    await mount('day:2026-10-26', jest.fn().mockResolvedValue({ steps: 4242 }));
    await waitFor(500);
    return getMMKV().getString(STORAGE_KEY) ?? null;
  };

  test('its own stamp reads back', async () => {
    const written = await roundTrip();

    expect(written).toContain('"version"');
    expect([...entriesFromStored(written).keys()]).toEqual(['day:2026-10-26']);
  });

  test('another build’s stamp reads as nothing', async () => {
    const blob = JSON.parse((await roundTrip()) ?? '{}') as {
      answers: unknown;
    };

    // What a device holds the first time it opens a release whose contracts
    // have moved: answers that parsed against the *old* schemas.
    const foreign = JSON.stringify({
      version: '0.9.0.1',
      answers: blob.answers,
    });

    expect(entriesFromStored(foreign).size).toBe(0);
  });

  test('the unversioned shape — the one before this — reads as nothing', () => {
    // Exactly what the build before the stamp left behind.
    expect(
      entriesFromStored(JSON.stringify({ 'day:2026-10-26': entry })).size,
    ).toBe(0);
  });

  test('a half-written blob is an empty cache, not a failed launch', () => {
    expect(entriesFromStored('{"version":').size).toBe(0);
    expect(entriesFromStored(null).size).toBe(0);
    expect(entriesFromStored('"a string"').size).toBe(0);
  });
});

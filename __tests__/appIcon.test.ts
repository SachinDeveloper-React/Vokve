/**
 * The launcher icon (RULES DV13): the server names the everyday icon and a
 * festive one, the member may turn festive icons off, and the phone shows
 * whichever applies — only ever among the icons its own build carries.
 *
 * @format
 */

jest.mock('vokve-app-icon', () => ({
  AppIcon: { getState: jest.fn(), setIcon: jest.fn() },
}));

jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  appApi: { about: jest.fn(), update: jest.fn(), icon: jest.fn() },
  deviceApi: { setAppIcon: jest.fn() },
}));

jest.mock('../src/services/device', () => ({
  ...jest.requireActual('../src/services/device'),
  getDeviceId: jest.fn(() => 'dev_1'),
}));

const { AppIcon } = jest.requireMock('vokve-app-icon') as {
  AppIcon: { getState: jest.Mock; setIcon: jest.Mock };
};
const { appApi, deviceApi } = jest.requireMock('../src/services/api/endpoints') as {
  appApi: { icon: jest.Mock };
  deviceApi: { setAppIcon: jest.Mock };
};
const { getDeviceId } = jest.requireMock('../src/services/device') as { getDeviceId: jest.Mock };

const {
  areFestiveIconsOn,
  chooseIcon,
  setFestiveIconsOn,
  syncAppIcon,
} = require('../src/services/appIcon') as typeof import('../src/services/appIcon');
const { getMMKV } = require('../src/stores') as typeof import('../src/stores');

const EVERY = ['redfield', 'classic', 'night', 'christmas', 'diwali', 'eid', 'holi', 'independence', 'newyear'];

const state = (over: Record<string, unknown> = {}) => ({
  supported: true,
  current: 'redfield',
  pending: null,
  available: EVERY,
  ...over,
});

beforeEach(() => {
  getMMKV().clearAll();
  jest.clearAllMocks();
  getDeviceId.mockReturnValue('dev_1');
  AppIcon.getState.mockResolvedValue(state());
  AppIcon.setIcon.mockResolvedValue('applied');
  appApi.icon.mockResolvedValue({ base: 'redfield', festive: null });
  deviceApi.setAppIcon.mockResolvedValue({ ok: true });
});

describe('which icon to ask for', () => {
  it('shows the festive icon when there is one, the member allows it and the build has it', () => {
    expect(chooseIcon({ base: 'redfield', festive: 'diwali' }, EVERY, true)).toBe('diwali');
  });

  it('keeps the base when the member turned festive icons off', () => {
    expect(chooseIcon({ base: 'night', festive: 'diwali' }, EVERY, false)).toBe('night');
  });

  it('skips a festive icon this build does not carry, rather than guessing', () => {
    expect(chooseIcon({ base: 'redfield', festive: 'lohri' }, EVERY, true)).toBe('redfield');
  });

  it('leaves the icon alone when the build carries neither key', () => {
    expect(chooseIcon({ base: 'gold', festive: 'lohri' }, EVERY, true)).toBeNull();
  });
});

describe('keeping the icon on what the server says', () => {
  it('switches to the festive icon and tells the server what the phone now shows', async () => {
    appApi.icon.mockResolvedValue({ base: 'redfield', festive: 'holi' });

    await expect(syncAppIcon()).resolves.toEqual({ status: 'applied', icon: 'holi' });
    expect(AppIcon.setIcon).toHaveBeenCalledWith('holi');
    expect(deviceApi.setAppIcon).toHaveBeenCalledWith('dev_1', 'holi');
  });

  it('does nothing — and on iOS shows no alert — when the icon is already right', async () => {
    await expect(syncAppIcon()).resolves.toEqual({ status: 'unchanged', icon: 'redfield' });
    expect(AppIcon.setIcon).not.toHaveBeenCalled();
  });

  it('on Android, reports the icon still showing while the swap waits for the member to leave', async () => {
    appApi.icon.mockResolvedValue({ base: 'redfield', festive: 'eid' });
    AppIcon.setIcon.mockResolvedValue('pending');

    await expect(syncAppIcon()).resolves.toEqual({ status: 'pending', icon: 'redfield' });
    expect(deviceApi.setAppIcon).toHaveBeenCalledWith('dev_1', 'redfield');
  });

  it('cancels a pending swap when the member turns festive icons off before leaving', async () => {
    AppIcon.getState.mockResolvedValue(state({ pending: 'eid' }));
    appApi.icon.mockResolvedValue({ base: 'redfield', festive: 'eid' });
    AppIcon.setIcon.mockResolvedValue('unchanged');
    setFestiveIconsOn(false);

    await syncAppIcon();
    expect(AppIcon.setIcon).toHaveBeenCalledWith('redfield');
  });

  it('remembers the festive switch, on until turned off', () => {
    expect(areFestiveIconsOn()).toBe(true);
    setFestiveIconsOn(false);
    expect(areFestiveIconsOn()).toBe(false);
  });

  it('offline, keeps the icon it has', async () => {
    appApi.icon.mockRejectedValue(new Error('Network Error'));
    await expect(syncAppIcon()).resolves.toMatchObject({ status: 'offline', icon: 'redfield' });
    expect(AppIcon.setIcon).not.toHaveBeenCalled();
  });

  it('survives iOS refusing while a system alert is up, to try again next time', async () => {
    appApi.icon.mockResolvedValue({ base: 'classic', festive: null });
    AppIcon.setIcon.mockRejectedValue(Object.assign(new Error('busy'), { code: 'SET_FAILED' }));
    await expect(syncAppIcon()).resolves.toEqual({ status: 'failed', icon: 'redfield' });
  });

  it('tells the server once per change, not on every foreground', async () => {
    await syncAppIcon();
    await syncAppIcon();
    expect(deviceApi.setAppIcon).toHaveBeenCalledTimes(1);
  });

  it('signed out, has no device to report for and still switches', async () => {
    getDeviceId.mockReturnValue(null);
    appApi.icon.mockResolvedValue({ base: 'night', festive: null });
    await expect(syncAppIcon()).resolves.toEqual({ status: 'applied', icon: 'night' });
    expect(deviceApi.setAppIcon).not.toHaveBeenCalled();
  });

  it('shares one run between calls that overlap', async () => {
    await Promise.all([syncAppIcon(), syncAppIcon(), syncAppIcon()]);
    expect(AppIcon.getState).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way where the OS cannot change icons', async () => {
    AppIcon.getState.mockResolvedValue(state({ supported: false }));
    await expect(syncAppIcon()).resolves.toEqual({ status: 'unsupported' });
    expect(appApi.icon).not.toHaveBeenCalled();
  });
});

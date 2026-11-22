import NativeVokveAppIcon, { type AppIconState } from './NativeVokveAppIcon';

export type { AppIconState };
export type SetIconOutcome = 'applied' | 'pending' | 'unchanged';

/**
 * VOKVE's launcher icon. Every icon has to be inside the build — neither OS
 * lets an app draw a home-screen icon it downloaded — so this only ever
 * chooses among `available`.
 *
 * Null when the native module is not in the binary (a test, or a build made
 * before it existed): the app then simply keeps the icon it has.
 */
export const AppIcon = NativeVokveAppIcon
  ? {
      getState: (): Promise<AppIconState> => NativeVokveAppIcon!.getState(),
      setIcon: async (key: string): Promise<SetIconOutcome> =>
        (await NativeVokveAppIcon!.setIcon(key)) as SetIconOutcome,
    }
  : null;

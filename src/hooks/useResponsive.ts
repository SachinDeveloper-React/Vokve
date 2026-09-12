import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { deviceInfo } from '../theme/responsive';

export type Breakpoint = 'compact' | 'medium' | 'expanded';

/** Window widths, in logical points, where the layout should change shape. */
export const BREAKPOINTS = {
  /** Phones in portrait. */
  compact: 0,
  /** Large phones in landscape, small tablets, half-screen iPad. */
  medium: 480,
  /** Tablets and full-width large screens. */
  expanded: 840,
} as const;

export interface Responsive {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isLandscape: boolean;
  isTablet: boolean;
  isSmallPhone: boolean;
  /**
   * Picks the value for the current breakpoint, falling back down the scale.
   * `select({ compact: 1, expanded: 3 })` gives 1 on a phone, 1 at medium
   * (nothing narrower is defined for it), and 3 on a tablet.
   */
  select: <T>(options: Partial<Record<Breakpoint, T>>) => T | undefined;
}

function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINTS.expanded) return 'expanded';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'compact';
}

/**
 * Reactive layout information.
 *
 * This reads the *window*, unlike the size scale in `theme/responsive`, which
 * reads the screen. Window dimensions change when the device rotates, when a
 * foldable opens, and when an iPad app is resized in Split View — exactly the
 * moments a layout needs to rearrange, while type sizes should hold still.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const breakpoint = breakpointFor(width);
    const order: Breakpoint[] = ['compact', 'medium', 'expanded'];
    const currentIndex = order.indexOf(breakpoint);

    return {
      width,
      height,
      breakpoint,
      isLandscape: width > height,
      isTablet: deviceInfo.isTablet,
      isSmallPhone: deviceInfo.isSmallPhone,
      select: <T,>(options: Partial<Record<Breakpoint, T>>): T | undefined => {
        // Walk down from the current breakpoint to the widest match defined.
        for (let i = currentIndex; i >= 0; i--) {
          const value = options[order[i]];
          if (value !== undefined) {
            return value;
          }
        }
        return undefined;
      },
    };
  }, [width, height]);
}

import React, { memo } from 'react';
import { BottomSheet } from '../disclosure/BottomSheet';
import { VStack } from '../layout/Stack';
import {
  SegmentedControl,
  type Segment,
} from '../form/SegmentedControl';
import { useTheme, type ThemeMode } from '../../theme';
import { useSettingsStore } from '../../stores/settingsStore';
import type { UnitSystem } from '../../types/models';
import { SettingsSection } from './SettingsSection';

const THEME_SEGMENTS: Segment<ThemeMode>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const UNIT_SEGMENTS: Segment<UnitSystem>[] = [
  { value: 'metric', label: 'kg / cm' },
  { value: 'imperial', label: 'lb / ft' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Theme and units, behind the account screen's Appearance shortcut.
 *
 * These two controls used to sit permanently on the account screen. They are
 * in a sheet now because the screen's job is navigation — a column of
 * destinations — and two live controls in the middle of it were the only
 * things on the page that changed something the moment they were touched.
 *
 * A sheet rather than a pushed screen: both settings apply instantly and are
 * visible behind the sheet as they change, so there is nothing to confirm and
 * nowhere to navigate back from.
 */
export const AppearanceSheet = memo(({ visible, onClose }: Props) => {
  const { mode, setMode } = useTheme();
  const units = useSettingsStore(s => s.units);
  const setUnits = useSettingsStore(s => s.setUnits);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Appearance">
      <VStack gap="md" pb="base">
        <SettingsSection title="Theme">
          <SegmentedControl
            segments={THEME_SEGMENTS}
            value={mode}
            onChange={setMode}
          />
        </SettingsSection>

        <SettingsSection title="Units">
          <SegmentedControl
            segments={UNIT_SEGMENTS}
            value={units}
            onChange={setUnits}
          />
        </SettingsSection>
      </VStack>
    </BottomSheet>
  );
});

AppearanceSheet.displayName = 'AppearanceSheet';

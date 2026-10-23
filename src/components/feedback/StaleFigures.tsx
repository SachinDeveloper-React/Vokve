import React, { memo } from 'react';
import { CloudOff } from 'lucide-react-native';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatTimeSince } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  /**
   * When what is on screen was fetched (`Loaded.cachedAt`). Null renders
   * nothing: there is no figure to date.
   */
  at: string | null;
  /** `Loaded.isStale` — the figures came out of storage, unrefreshed. */
  stale: boolean;
}

/**
 * A date on figures the app could not refresh.
 *
 * The screens here are server reads, and since those answers survive the
 * process (`useServerRead`) a phone with no network opens on the last ones
 * instead of an empty state. That is the whole point — but a step count with
 * no date on it stops being true the moment it is out of date, and a user
 * deciding whether they have hit their goal needs to know they are looking
 * at this morning's answer.
 *
 * Nothing is drawn while the figures are this session's own: a line saying
 * "updated just now" under every panel is noise, and it would train people
 * to stop reading the one case that matters.
 */
export const StaleFigures = memo(({ at, stale }: Props) => {
  const { isOffline } = useNetworkStatus();

  if (!stale || at === null) {
    return null;
  }

  return (
    <HStack align="center" gap="xs" accessibilityLiveRegion="polite">
      <Icon as={CloudOff} size="xs" color="textTertiary" />
      <AppText variant="micro" color="textTertiary" numberOfLines={1}>
        {isOffline
          ? `Offline — your last synced figures, updated ${formatTimeSince(at)}`
          : `Last updated ${formatTimeSince(at)}`}
      </AppText>
    </HStack>
  );
});

StaleFigures.displayName = 'StaleFigures';

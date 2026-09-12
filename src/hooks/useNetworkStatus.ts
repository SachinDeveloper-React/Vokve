import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export interface NetworkStatus {
  /** The device has a network interface up. */
  isConnected: boolean;
  /**
   * That interface can actually reach the internet. Null while unknown —
   * treat null as "assume online" so the UI does not flash an offline
   * warning during the first probe.
   */
  isInternetReachable: boolean | null;
  isOffline: boolean;
}

/**
 * Subscribes to connectivity changes.
 *
 * `isConnected` alone is not enough: a phone joined to a gym's captive-portal
 * wifi reports a connection while every request still fails. Offline is
 * declared only when reachability is explicitly false.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: null,
    isOffline: false,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const isConnected = state.isConnected ?? false;
      const isInternetReachable = state.isInternetReachable;

      setStatus({
        isConnected,
        isInternetReachable,
        isOffline: !isConnected || isInternetReachable === false,
      });
    });

    return unsubscribe;
  }, []);

  return status;
}

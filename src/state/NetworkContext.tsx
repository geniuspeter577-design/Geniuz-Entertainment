import * as Network from 'expo-network';
import type { NetworkState } from 'expo-network';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { isNetworkOnline } from '../utils/networkStatus';

type NetworkContextValue = {
  isOnline: boolean;
  isWifi: boolean;
  isReady: boolean;
  retryConnection: () => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: React.PropsWithChildren) {
  const [state, setState] = useState({ isOnline: false, isWifi: false, isReady: false });

  const updateNetwork = useCallback((networkState: NetworkState) => {
    const isOnline = isNetworkOnline(networkState);
    setState({
      isOnline,
      isWifi: networkState.type === Network.NetworkStateType.WIFI,
      isReady: true,
    });
  }, []);

  const retryConnection = useCallback(async () => {
    try {
      updateNetwork(await Network.getNetworkStateAsync());
    } catch (error) {
      console.error('[Network] Could not check connectivity.', error);
      setState((current) => ({ ...current, isOnline: false, isWifi: false, isReady: true }));
    }
  }, [updateNetwork]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener(updateNetwork);
    Network.getNetworkStateAsync()
      .then(updateNetwork)
      .catch((error: unknown) => {
        console.error('[Network] Could not check connectivity.', error);
        setState((current) => ({ ...current, isOnline: false, isReady: true }));
      });
    return () => subscription.remove();
  }, [updateNetwork]);

  return (
    <NetworkContext.Provider value={{ ...state, retryConnection }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within NetworkProvider.');
  }
  return context;
}

export function isNetworkOnline(state: {
  isConnected?: boolean;
  isInternetReachable?: boolean | null;
}) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

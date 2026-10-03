export type AdminRouteState = 'admin' | 'sign-in' | 'not-found';

export function getAdminRouteState({
  isAdmin,
  isSignedIn,
  canSignIn,
}: {
  isAdmin: boolean;
  isSignedIn: boolean;
  canSignIn: boolean;
}): AdminRouteState {
  if (isAdmin) {
    return 'admin';
  }
  if (isSignedIn) {
    return 'not-found';
  }
  return canSignIn ? 'sign-in' : 'not-found';
}

export function isAdminMetadata(metadata: unknown) {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'role' in metadata &&
    Reflect.get(metadata, 'role') === 'admin'
  );
}

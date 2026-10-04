import { router, type Href } from 'expo-router';

export function backOrReplace(fallback: Href = '/') {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}

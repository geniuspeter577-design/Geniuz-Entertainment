import { useCallback, useEffect, useState } from 'react';

import type { ContentQueryResult } from '../models/content';
import { getFriendlyCatalogErrorMessage } from '../utils/contentError';

export type ContentQueryState<T> = {
  data: T | null;
  source: 'mock' | 'tmdb' | 'supabase' | 'local' | 'api' | null;
  warning?: string;
  error?: string;
  isLoading: boolean;
  isRefreshing: boolean;
  retry: () => void;
};

type InternalQueryState<T> = Omit<ContentQueryState<T>, 'retry' | 'isLoading' | 'isRefreshing'> & {
  queryKey: string;
  attempt: number;
  isFetching: boolean;
};

export function useContentQuery<T>(
  queryKey: string,
  load: () => Promise<ContentQueryResult<T>>,
  enabled = true,
): ContentQueryState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<InternalQueryState<T>>({
    data: null,
    source: null,
    queryKey: '',
    attempt: -1,
    isFetching: false,
  });

  useEffect(() => {
    let active = true;
    if (!enabled) {
      return () => {
        active = false;
      };
    }

    Promise.resolve()
      .then(() => {
        if (!active) {
          return undefined;
        }
        setState((current) => ({
          queryKey,
          attempt,
          data: current.queryKey === queryKey ? current.data : null,
          source: current.queryKey === queryKey ? current.source : null,
          isFetching: true,
        }));
        return load();
      })
      .then((result) => {
        if (active && result) {
          setState({
            queryKey,
            attempt,
            data: result.data,
            source: result.source,
            isFetching: false,
            ...(result.warning ? { warning: result.warning } : {}),
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState((current) => ({
            queryKey,
            attempt,
            data: current.queryKey === queryKey ? current.data : null,
            source: current.queryKey === queryKey ? current.source : null,
            error: getFriendlyCatalogErrorMessage(error),
            isFetching: false,
          }));
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, enabled, load, queryKey]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const queryMatchesKey = state.queryKey === queryKey;
  const queryMatchesRequest = queryMatchesKey && state.attempt === attempt;
  const isFetching =
    enabled && (!queryMatchesRequest || (queryMatchesRequest && state.isFetching));

  return {
    data: queryMatchesKey ? state.data : null,
    source: queryMatchesKey ? state.source : null,
    warning: queryMatchesRequest ? state.warning : undefined,
    error: queryMatchesRequest ? state.error : undefined,
    isLoading: enabled && (!queryMatchesKey || (state.data === null && isFetching)),
    isRefreshing: queryMatchesKey && isFetching && state.data !== null,
    retry,
  };
}

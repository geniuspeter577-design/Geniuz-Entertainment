import { useCallback, useEffect, useState } from 'react';

import type { ContentQueryResult } from '../models/content';

export type ContentQueryState<T> = {
  data: T | null;
  source: 'mock' | 'tmdb' | 'supabase' | null;
  warning?: string;
  error?: string;
  isLoading: boolean;
  retry: () => void;
};

type InternalQueryState<T> = Omit<ContentQueryState<T>, 'retry' | 'isLoading'> & {
  queryKey: string;
  attempt: number;
};

export function useContentQuery<T>(
  queryKey: string,
  load: () => Promise<ContentQueryResult<T>>,
): ContentQueryState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<InternalQueryState<T>>({
    data: null,
    source: null,
    queryKey: '',
    attempt: -1,
  });

  useEffect(() => {
    let active = true;

    load()
      .then((result) => {
        if (active) {
          setState({
            queryKey,
            attempt,
            data: result.data,
            source: result.source,
            ...(result.warning ? { warning: result.warning } : {}),
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          console.error(`[useContentQuery] Loading "${queryKey}" failed.`, error);
          setState({
            queryKey,
            attempt,
            data: null,
            source: null,
            error: 'We could not load this content. Check your connection and try again.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, load, queryKey]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const queryMatches = state.queryKey === queryKey && state.attempt === attempt;

  return {
    data: queryMatches ? state.data : null,
    source: queryMatches ? state.source : null,
    warning: queryMatches ? state.warning : undefined,
    error: queryMatches ? state.error : undefined,
    isLoading: !queryMatches,
    retry,
  };
}

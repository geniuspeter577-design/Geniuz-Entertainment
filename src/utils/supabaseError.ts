export type SupabaseErrorDetails = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type SupabaseQueryContext = {
  table: string;
  columns: string;
};

export function getSupabaseErrorDetails(error: unknown): SupabaseErrorDetails {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  const result: SupabaseErrorDetails = {};
  for (const field of ['code', 'message', 'details', 'hint'] as const) {
    const value = Reflect.get(error, field);
    if (typeof value === 'string') {
      result[field] = value;
    }
  }
  return result;
}

export function logSupabaseError(
  context: string,
  error: unknown,
  query?: SupabaseQueryContext,
) {
  if (process.env.NODE_ENV === 'development') {
    console.error(context, {
      ...(query ? { table: query.table, columns: query.columns } : {}),
      ...getSupabaseErrorDetails(error),
    });
  }
}

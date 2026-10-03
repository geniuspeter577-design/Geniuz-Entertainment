export type TitleCleanupAsset =
  | { kind: 'b2'; key: string }
  | { kind: 'supabase-video'; path: string }
  | { kind: 'image'; url: string };

export type PendingTitleCleanup = {
  titleId: string;
  title: string;
  assets: TitleCleanupAsset[];
};

export type TitleCleanupFailure = {
  asset: TitleCleanupAsset;
  error: unknown;
};

export function getTitleDeletionErrorDetails(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  const details: { status?: number; code?: string; message?: string } = {};
  const status = Reflect.get(error, 'status');
  const code = Reflect.get(error, 'code');
  const message = Reflect.get(error, 'serviceMessage') ?? Reflect.get(error, 'message');
  if (typeof status === 'number') {
    details.status = status;
  }
  if (typeof code === 'string') {
    details.code = code;
  }
  if (typeof message === 'string') {
    details.message = message;
  }
  return details;
}

export function logTitleCleanupFailures(failures: readonly TitleCleanupFailure[]) {
  if (process.env.NODE_ENV === 'development' && failures.length) {
    console.error(
      '[AdminScreen] Title cleanup failures.',
      failures.map(({ asset, error }) => ({
        kind: asset.kind,
        ...getTitleDeletionErrorDetails(error),
      })),
    );
  }
}

export async function deleteRecordThenCleanup(
  record: PendingTitleCleanup,
  deleteRecord: () => Promise<void>,
  removeAsset: (asset: TitleCleanupAsset) => Promise<void>,
) {
  await deleteRecord();
  const assets: TitleCleanupAsset[] = [];
  const failures: TitleCleanupFailure[] = [];
  for (const asset of record.assets) {
    try {
      await removeAsset(asset);
    } catch (error) {
      assets.push(asset);
      failures.push({ asset, error });
    }
  }
  return { pending: assets.length ? { ...record, assets } : undefined, failures };
}

export async function retryTitleCleanup(
  record: PendingTitleCleanup,
  removeAsset: (asset: TitleCleanupAsset) => Promise<void>,
) {
  const assets: TitleCleanupAsset[] = [];
  const failures: TitleCleanupFailure[] = [];
  for (const asset of record.assets) {
    try {
      await removeAsset(asset);
    } catch (error) {
      assets.push(asset);
      failures.push({ asset, error });
    }
  }
  return { pending: assets.length ? { ...record, assets } : undefined, failures };
}

export function isPendingTitleCleanup(value: unknown): value is PendingTitleCleanup {
  if (typeof value !== 'object' || value === null || !('titleId' in value) || !('title' in value) || !('assets' in value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.titleId === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.assets) &&
    candidate.assets.every((asset) => {
      if (typeof asset !== 'object' || asset === null || !('kind' in asset)) {
        return false;
      }
      const entry = asset as Record<string, unknown>;
      return (
        (entry.kind === 'b2' && typeof entry.key === 'string') ||
        (entry.kind === 'supabase-video' && typeof entry.path === 'string') ||
        (entry.kind === 'image' && typeof entry.url === 'string')
      );
    })
  );
}

export function getTitleCleanupFailureMessage(kind: TitleCleanupAsset['kind']) {
  switch (kind) {
    case 'b2':
      return 'video or trailer file';
    case 'supabase-video':
      return 'video file';
    case 'image':
      return 'image';
  }
}

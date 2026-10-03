export type UploadedMovieDraft<TMovie> = {
  movie: TMovie;
  storageKey: string;
};

export async function retryUploadedMovieSave<TMovie, TResult>(
  draft: UploadedMovieDraft<TMovie>,
  save: (movie: TMovie, storageKey: string) => Promise<TResult>,
) {
  return save(draft.movie, draft.storageKey);
}

export async function deleteOrphanedUpload<TMovie>(
  draft: UploadedMovieDraft<TMovie>,
  deleteObject: (storageKey: string) => Promise<void>,
) {
  await deleteObject(draft.storageKey);
}

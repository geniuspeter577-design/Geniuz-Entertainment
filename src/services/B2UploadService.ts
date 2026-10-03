type UploadFile = {
  size: number;
  readPart: (start: number, end: number, contentType: string) => Promise<Blob>;
};

type UploadOptions = {
  apiBaseUrl: string;
  accessToken: string;
  file: UploadFile;
  fileName: string;
  contentType: string;
  objectType?: 'movie' | 'episode';
  kind?: 'video' | 'trailer';
  signal: AbortSignal;
  onProgress: (progress: number) => void;
};

type MultipartUpload = {
  uploadId: string;
  key: string;
  partSize: number;
};

type PartUrl = {
  partNumber: number;
  url: string;
};

export class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly serviceMessage: string,
  ) {
    super(message);
    this.name = 'UploadRequestError';
  }
}

function makeApiUrl(baseUrl: string, path: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('The Geniuz API is not configured. Restart the app after setting its URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('The Geniuz API URL must use HTTPS.');
  }
  return `${normalized}${path}`;
}

function safeApiBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '[invalid API URL]';
  }
}

async function requestJson<T>(
  apiBaseUrl: string,
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Upload canceled.');
    }
    console.error(
      `[B2UploadService] Network/CORS request failed for ${safeApiBaseUrl(apiBaseUrl)}.`,
      error instanceof Error ? error.name : 'Unknown network error',
    );
    throw new Error(
      'Could not connect to the upload service. This may be a network or CORS issue. Check that the API port is Public and CORS allows this app, then retry.',
      {
        cause: error,
      },
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    if (!response.ok) {
      throw new UploadRequestError(
        response.status === 401 || response.status === 403
          ? 'Your admin session is invalid or expired. Sign in as an admin again, then retry.'
          : response.status >= 500
            ? 'The upload service encountered a server error. Please try again later.'
            : 'The upload service could not complete the request.',
        response.status,
        'INVALID_ERROR_RESPONSE',
        'The upload service returned an invalid error response.',
      );
    }
    throw new Error('The upload service returned an invalid response.');
  }
  if (!response.ok) {
    const serviceMessage =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'object' &&
      result.error !== null &&
      'message' in result.error &&
      typeof result.error.message === 'string'
        ? result.error.message
        : 'The upload service could not complete the request.';
    const code =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'object' &&
      result.error !== null &&
      'code' in result.error &&
      typeof result.error.code === 'string'
        ? result.error.code
        : 'UPLOAD_SERVICE_ERROR';
    throw new UploadRequestError(
      response.status === 401 || response.status === 403
        ? 'Your admin session is invalid or expired. Sign in as an admin again, then retry.'
        : response.status >= 500
          ? 'The upload service encountered a server error. Please try again later.'
          : serviceMessage,
      response.status,
      code,
      serviceMessage,
    );
  }
  return result as T;
}

function waitBeforeRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Upload canceled.'));
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('Upload canceled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function uploadPart(
  partUrl: PartUrl,
  filePart: Blob,
  contentType: string,
  signal: AbortSignal,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal.aborted) {
      throw new Error('Upload canceled.');
    }
    try {
      const response = await fetch(partUrl.url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: filePart,
        signal,
      });
      if (!response.ok) {
        throw new Error(`Backblaze rejected upload part ${partUrl.partNumber} (HTTP ${response.status}).`);
      }
      const etag = response.headers.get('ETag');
      if (!etag) {
        throw new Error('The storage service did not return an ETag for an uploaded part.');
      }
      return { partNumber: partUrl.partNumber, etag };
    } catch (error) {
      if (signal.aborted) {
        throw new Error('Upload canceled.');
      }
      lastError = error;
      if (attempt < 3) {
        await waitBeforeRetry(500 * (attempt + 1), signal);
      }
    }
  }
  throw new Error(
    `Could not upload part ${partUrl.partNumber} after 3 retries. Check your connection and retry.`,
    { cause: lastError },
  );
}

export async function uploadVideoToB2({
  apiBaseUrl,
  accessToken,
  file,
  fileName,
  contentType,
  objectType = 'movie',
  kind = 'video',
  signal,
  onProgress,
}: UploadOptions) {
  let multipart: MultipartUpload | undefined;
  let completed = false;
  const initUrl = makeApiUrl(apiBaseUrl, '/uploads/init');

  try {
    multipart = await requestJson<MultipartUpload>(
      apiBaseUrl,
      initUrl,
      accessToken,
      {
        fileName,
        fileSize: file.size,
        contentType,
        objectType,
        kind,
      },
    );
    if (signal.aborted) {
      throw new Error('Upload canceled.');
    }

    const partCount = Math.ceil(file.size / multipart.partSize);
    if (!Number.isInteger(partCount) || partCount < 1 || partCount > 64) {
      throw new Error('The upload service returned an invalid part size.');
    }

    const parts: { partNumber: number; etag: string }[] = [];
    for (let firstPart = 1; firstPart <= partCount; firstPart += 3) {
      if (signal.aborted) {
        throw new Error('Upload canceled.');
      }
      const partNumbers = Array.from(
        { length: Math.min(3, partCount - firstPart + 1) },
        (_, index) => firstPart + index,
      );
      const { parts: signedParts } = await requestJson<{ parts: PartUrl[] }>(
        apiBaseUrl,
        makeApiUrl(apiBaseUrl, '/uploads/part-urls'),
        accessToken,
        { key: multipart.key, uploadId: multipart.uploadId, partNumbers },
        signal,
      );
      if (signedParts.length !== partNumbers.length) {
        throw new Error('The upload service returned an incomplete list of part URLs.');
      }

      const uploadedParts = await Promise.all(
        signedParts.map((partUrl) => {
          const start = (partUrl.partNumber - 1) * multipart!.partSize;
          const end = Math.min(start + multipart!.partSize, file.size);
          return file
            .readPart(start, end, contentType)
            .then((filePart) => uploadPart(partUrl, filePart, contentType, signal));
        }),
      );
      parts.push(...uploadedParts);
      onProgress(Math.min(95, Math.floor((parts.length / partCount) * 95)));
    }

    if (signal.aborted) {
      throw new Error('Upload canceled.');
    }
    await requestJson(
      apiBaseUrl,
      makeApiUrl(apiBaseUrl, '/uploads/complete'),
      accessToken,
      { key: multipart.key, uploadId: multipart.uploadId, parts },
      signal,
    );
    completed = true;
    onProgress(100);
    return multipart.key;
  } catch (error) {
    if (multipart && !completed) {
      try {
        await requestJson(
          apiBaseUrl,
          makeApiUrl(apiBaseUrl, '/uploads/abort'),
          accessToken,
          { key: multipart.key, uploadId: multipart.uploadId },
        );
      } catch (abortError) {
        throw new Error(
          'The upload failed and its temporary multipart data could not be canceled. Contact an administrator before retrying.',
          { cause: abortError },
        );
      }
    }

    throw error;
  }
}

export async function deleteUploadedB2Object({
  apiBaseUrl,
  accessToken,
  key,
}: {
  apiBaseUrl: string;
  accessToken: string;
  key: string;
}) {
  await requestJson(
    apiBaseUrl,
    makeApiUrl(apiBaseUrl, '/uploads/delete'),
    accessToken,
    { key },
  );
}

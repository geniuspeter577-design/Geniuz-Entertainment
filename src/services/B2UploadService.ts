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

async function requestJson<T>(
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
    throw new Error('Could not reach the upload service. Check your connection and retry.', {
      cause: error,
    });
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('The upload service returned an invalid response.');
  }
  if (!response.ok) {
    const message =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'object' &&
      result.error !== null &&
      'message' in result.error &&
      typeof result.error.message === 'string'
        ? result.error.message
        : 'The upload service could not complete the request.';
    throw new Error(message);
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
  signal,
  onProgress,
}: UploadOptions) {
  let multipart: MultipartUpload | undefined;
  let completed = false;
  const initUrl = makeApiUrl(apiBaseUrl, '/uploads/init');

  try {
    multipart = await requestJson<MultipartUpload>(initUrl, accessToken, {
      fileName,
      fileSize: file.size,
      contentType,
    });
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

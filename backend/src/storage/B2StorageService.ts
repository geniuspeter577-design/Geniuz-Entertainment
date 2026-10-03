import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  DeleteObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { VIDEO_UPLOAD_PART_SIZE_BYTES } from '../constants/video';
import type { Config } from '../config/config';
import { HttpError } from '../http/errors';
import { generateObjectKey, validatePartNumbers, type UploadInput } from './uploadValidation';

const MAX_MULTIPART_PARTS = 64;
const PLAY_URL_EXPIRY_SECONDS = 2 * 60 * 60;
const TRAILER_URL_EXPIRY_SECONDS = 15 * 60;

export class B2StorageService {
  private readonly client: S3Client;

  constructor(private readonly config: Config) {
    if (
      !config.s3Endpoint ||
      !config.s3Region ||
      !config.s3AccessKeyId ||
      !config.s3SecretAccessKey ||
      !config.s3Bucket
    ) {
      throw new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'Backblaze storage is not configured.');
    }

    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    });
  }

  async startMultipartUpload(
    fileName: string,
    contentType: string,
    objectType: UploadInput['objectType'],
    kind: UploadInput['kind'] = 'video',
  ) {
    const key = generateObjectKey(fileName, undefined, kind === 'trailer' ? 'trailer' : objectType);
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new HttpError(502, 'UPLOAD_INIT_FAILED', 'Could not start the video upload.');
    }
    return {
      uploadId: result.UploadId,
      key,
      partSize: VIDEO_UPLOAD_PART_SIZE_BYTES,
    };
  }

  async createPartUrls(key: string, uploadId: string, value: unknown) {
    const partNumbers = validatePartNumbers(value, MAX_MULTIPART_PARTS);
    await this.verifyMultipartUpload(key, uploadId);
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.client,
          new UploadPartCommand({
            Bucket: this.config.s3Bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: 60 * 60 },
        ),
      })),
    );
    return { parts };
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]) {
    const uploaded = await this.verifyMultipartUpload(key, uploadId);
    const uploadedParts = new Map(
      (uploaded.Parts ?? []).map((part) => [part.PartNumber, part.ETag]),
    );
    if (parts.some((part) => uploadedParts.get(part.PartNumber) !== part.ETag)) {
      throw new HttpError(400, 'INVALID_PARTS', 'The uploaded part list does not match storage.');
    }

    const result = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    if (!result.Key) {
      throw new HttpError(502, 'UPLOAD_COMPLETE_FAILED', 'Could not finish the video upload.');
    }
    return { key: result.Key };
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    await this.verifyMultipartUpload(key, uploadId);
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async createPlayUrl(key: string) {
    await this.verifyObjectExists(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
      }),
      { expiresIn: PLAY_URL_EXPIRY_SECONDS },
    );
  }

  async checkBucket() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.s3Bucket }));
  }

  async createPlaybackProbeUrl(key: string) {
    if (!key.trim()) {
      throw new HttpError(404, 'PLAYBACK_FILE_MISSING', 'This movie is missing its video file.');
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
      { expiresIn: 60 },
    );
  }

  async createTrailerPlayUrl(key: string) {
    if (!/^trailers\/[a-f0-9-]+(?:\.[a-z0-9]{1,12})?$/i.test(key)) {
      throw new HttpError(400, 'INVALID_TRAILER_KEY', 'The trailer object key is invalid.');
    }
    await this.verifyObjectExists(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
      }),
      { expiresIn: TRAILER_URL_EXPIRY_SECONDS },
    );
  }

  async deleteObject(key: string) {
    if (!/^(?:movies|episodes|trailers)\/[a-f0-9-]+(?:\.[a-z0-9]{1,12})?$/i.test(key)) {
      throw new HttpError(400, 'INVALID_OBJECT_KEY', 'The stored object key is invalid.');
    }
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        const code =
          typeof error === 'object' && error !== null && 'Code' in error
            ? error.Code
            : typeof error === 'object' && error !== null && 'code' in error
              ? error.code
              : undefined;
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? error.message
            : undefined;
        console.error('[B2StorageService] Object deletion failed.', {
          code: typeof code === 'string' ? code : undefined,
          message: typeof message === 'string' ? message : undefined,
        });
      }
      throw new HttpError(
        502,
        'B2_DELETE_FAILED',
        'Backblaze could not delete this object. Check the bucket-scoped key permissions and retry cleanup.',
      );
    }
  }

  private async verifyMultipartUpload(key: string, uploadId: string) {
    if (!/^(?:movies|episodes|trailers)\/[a-f0-9-]+(?:\.[a-z0-9]{1,12})?$/i.test(key) || !uploadId || uploadId.length > 2048) {
      throw new HttpError(400, 'INVALID_UPLOAD', 'The multipart upload details are invalid.');
    }
    try {
      return await this.client.send(
        new ListPartsCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
          UploadId: uploadId,
          MaxParts: MAX_MULTIPART_PARTS,
        }),
      );
    } catch {
      throw new HttpError(404, 'UPLOAD_NOT_FOUND', 'The active video upload could not be found.');
    }
  }

  private async verifyObjectExists(key: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
        }),
      );
    } catch (error) {
      const candidate = error as {
        name?: string;
        code?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const status = candidate.$metadata?.httpStatusCode;
      const code = candidate.code ?? candidate.Code ?? candidate.name;
      if (status === 404 || code === 'NoSuchKey' || code === 'NotFound') {
        throw new HttpError(404, 'PLAYBACK_FILE_NOT_FOUND', 'The video file is missing from storage.');
      }
      if (status === 403 || code === 'AccessDenied') {
        throw new HttpError(
          502,
          'B2_READ_ACCESS_DENIED',
          'Backblaze denied playback access. Check the daily download cap and the backend key readFiles scope for this bucket.',
        );
      }
      throw new HttpError(502, 'B2_PLAYBACK_CHECK_FAILED', 'Could not verify the video file in storage.');
    }
  }
}

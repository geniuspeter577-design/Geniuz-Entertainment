import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { VIDEO_UPLOAD_PART_SIZE_BYTES } from '../../../src/constants/video';
import type { Config } from '../config/config';
import { HttpError } from '../http/errors';
import { generateObjectKey, validatePartNumbers, type UploadInput } from './uploadValidation';

const MAX_MULTIPART_PARTS = 64;
const PLAY_URL_EXPIRY_SECONDS = 2 * 60 * 60;

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

  async startMultipartUpload(fileName: string, contentType: string, objectType: UploadInput['objectType']) {
    const key = generateObjectKey(fileName, undefined, objectType);
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
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
      }),
      { expiresIn: PLAY_URL_EXPIRY_SECONDS },
    );
  }

  private async verifyMultipartUpload(key: string, uploadId: string) {
    if (!/^(?:movies|episodes)\/[a-f0-9-]+(?:\.[a-z0-9]{1,12})?$/i.test(key) || !uploadId || uploadId.length > 2048) {
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
}

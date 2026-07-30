import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './storage.provider';
@Injectable()
export class R2StorageProvider implements StorageProvider {
  async createPresignedUpload(command: {
    key: string;
    contentType: string;
    contentLength: number;
  }) {
    const c = this.client();
    return {
      uploadUrl: await getSignedUrl(
        c,
        new PutObjectCommand({
          Bucket: this.env('R2_BUCKET_NAME'),
          Key: command.key,
          ContentType: command.contentType,
          ContentLength: command.contentLength,
        }),
        { expiresIn: 300 },
      ),
    };
  }
  publicUrl(key: string) {
    return `${this.env('R2_PUBLIC_BASE_URL').replace(/\/$/, '')}/${key}`;
  }
  private client() {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${this.env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.env('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.env('R2_SECRET_ACCESS_KEY'),
      },
    });
  }
  private env(
    name:
      | 'R2_ACCOUNT_ID'
      | 'R2_ACCESS_KEY_ID'
      | 'R2_SECRET_ACCESS_KEY'
      | 'R2_BUCKET_NAME'
      | 'R2_PUBLIC_BASE_URL',
  ) {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`${name} must be configured before using object storage.`);
    return v;
  }
}

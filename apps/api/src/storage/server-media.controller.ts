import { Controller, Put, Get, Param, Query, Req, Res, Inject, HttpCode } from '@nestjs/common';
type Request = AsyncIterable<Buffer> & { headers: Record<string, string | undefined> };
type Response = { set(headers: Record<string, string>): Response; send(body: Buffer): void };
import { Public } from '../tenancy/tenant-context.decorator';
import { ServerStorageProvider } from './server-storage.provider';
@Controller('media')
@Public()
export class ServerMediaController {
  constructor(@Inject(ServerStorageProvider) private readonly storage: ServerStorageProvider) {}
  @Put('upload/:tenantId/:propertyId/:token')
  @HttpCode(204)
  async upload(
    @Param('tenantId') tenantId: string,
    @Param('propertyId') propertyId: string,
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    await this.storage.upload({ tenantId, propertyId }, token, req.headers['content-type'], req);
  }
  @Get('image') async image(@Query('key') key: string, @Res() res: Response) {
    const image = await this.storage.image(key);
    res
      .set({
        'Content-Type': image.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public,max-age=31536000,immutable',
      })
      .send(image.data);
  }
}

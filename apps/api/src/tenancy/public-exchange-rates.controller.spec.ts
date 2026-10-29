import { Logger, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ExchangeRatesService } from './exchange-rates.service';
import { PropertyCurrencyService } from './property-currency.service';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { describe, expect, it, vi } from 'vitest';
import { PublicExchangeRatesController } from './public-exchange-rates.controller';

describe('public exchange-rate ETags', () => {
  it('returns 304 for matching content, and a changed feed changes ETag even at the same property version', async () => {
    const rates = {
      ratesFor: vi.fn().mockResolvedValue({
        base: 'ALL',
        date: '2026-10-28',
        rates: { EUR: 0.01 },
        sources: { EUR: 'hotel' },
        version: '2',
        displayCurrencies: ['EUR'],
      }),
    };
    const controller = new PublicExchangeRatesController(
      rates as never,
      { resolve: vi.fn().mockResolvedValue({ currency: 'ALL' }) } as never,
    );
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status: vi.fn(),
    };
    const scope = { tenantId: 't', propertyId: 'p' };
    const payload = await controller.getExchangeRates(
      { currencies: 'EUR' },
      { tenantContext: scope },
      response,
    );
    expect(payload).toMatchObject({
      base: 'ALL',
      approximate: true,
      version: '2',
      sources: { EUR: 'hotel' },
    });
    const etag = headers.ETag;
    expect(rates.ratesFor).toHaveBeenCalledWith('ALL', ['EUR'], scope);
    expect(
      await controller.getExchangeRates(
        { currencies: 'EUR' },
        { tenantContext: scope, headers: { 'if-none-match': etag } },
        response,
      ),
    ).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(304);
    rates.ratesFor.mockResolvedValueOnce({
      ...payload,
      rates: { EUR: 0.0099 },
      sources: { EUR: 'feed' },
    });
    expect(
      await controller.getExchangeRates(
        { currencies: 'EUR' },
        { tenantContext: scope, headers: { 'if-none-match': etag } },
        response,
      ),
    ).toHaveProperty('rates.EUR', 0.0099);
    expect(headers.ETag).not.toBe(etag);
  });
  it('sends an empty HTTP 304 response with the matching ETag', async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicExchangeRatesController],
      providers: [
        {
          provide: ExchangeRatesService,
          useValue: {
            ratesFor: vi.fn().mockResolvedValue({
              base: 'ALL',
              date: '2026-10-28',
              rates: { EUR: 0.01 },
              sources: { EUR: 'hotel' },
              version: '2',
            }),
          },
        },
        {
          provide: PropertyCurrencyService,
          useValue: { resolve: vi.fn().mockResolvedValue({ currency: 'ALL' }) },
        },
      ],
    })
      .overrideGuard(PublicRateLimitGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().tenantContext = { tenantId: 't', propertyId: 'p' };
          return true;
        },
      })
      .compile();
    const app = module.createNestApplication();
    const errors = vi.spyOn(Logger.prototype, 'error');
    try {
      await app.init();
      const url = '/tenants/t/properties/p/public/exchange-rates?currencies=EUR';
      const first = await request(app.getHttpServer()).get(url).expect(200);
      const next = await request(app.getHttpServer())
        .get(url)
        .set('If-None-Match', first.headers.etag)
        .expect(304);
      expect(next.text).toBe('');
      expect(next.headers.etag).toBe(first.headers.etag);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      await app.close();
      errors.mockRestore();
    }
  });
});

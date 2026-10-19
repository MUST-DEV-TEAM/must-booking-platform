import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService } from './tenant-database.service';
import { pricingContext } from './pricing.repository';
import { reportFacts } from './report-facts.repository';
import { parseReportQuery } from './report-query';
import { propertyDay, shiftDay } from './report-metrics';
import { otbObservation } from './report-otb';

type Context = { tenantId: string; propertyId: string };
/** Scoped daily evidence collection. Never contacts a provider or accepts a historical capture date. */
@Injectable()
export class ReportOtbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportOtbService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) return;
    this.connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('reports.otb', { connection: this.connection });
    this.worker = new Worker(
      'reports.otb',
      async (job) => {
        if (job.name === 'sweep') await this.sweep();
        else await this.capture(job.data as Context);
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('error', () => this.logger.error('Report snapshot worker failed.'));
    await this.queue.upsertJobScheduler(
      'reports-otb-hourly',
      { every: 3600000 },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
  async sweep() {
    const properties = await this.database.$queryRaw<
      Array<Context & { timezone: string }>
    >`SELECT "tenantId","propertyId",timezone FROM scheduled_email_properties()`;
    for (const c of properties)
      if (this.queue)
        await this.queue.add('capture', c, {
          jobId: `${c.tenantId}-${c.propertyId}-${propertyDay(new Date(), c.timezone)}`,
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        });
      else await this.capture(c);
  }
  async capture(c: Context) {
    for (let attempt = 0; ; attempt++)
      try {
        return await this.captureAttempt(c);
      } catch (error) {
        if (
          attempt >= 2 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2010', 'P2002'].includes(error.code) ||
          (error.code === 'P2010' && !['40001', '23505'].includes(String(error.meta?.code)))
        )
          throw error;
      }
  }
  private async captureAttempt(c: Context) {
    return this.database.withTenantTransaction(
      c,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ':' + c.propertyId + ':otb'},0))`;
        const property = await pricingContext(tx, c.tenantId, c.propertyId);
        const clock = await tx.$queryRaw<
          Array<{ now: string }>
        >`SELECT transaction_timestamp()::text AS now`;
        const now = new Date(clock[0]!.now),
          today = propertyDay(now, property.timezone);
        const hour = Number(
          new Intl.DateTimeFormat('en', {
            timeZone: property.timezone,
            hour: '2-digit',
            hourCycle: 'h23',
          }).format(now),
        );
        if (hour < 2) return { captured: false, reason: 'Before local capture hour' };
        // Serialized collectors retry the entire pure database transaction after a snapshot conflict.
        const exists = await tx.$queryRaw<
          Array<{ date: string }>
        >`SELECT snapshot_date::text AS date FROM report_otb_snapshots WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND snapshot_date=${today}::date`;
        if (exists.length) return { captured: false, reason: 'Already captured' };
        const q = parseReportQuery(
          { report: 'reservations', from: today, to: shiftDay(today, 364) },
          today,
        );
        const facts = await reportFacts(tx, c.tenantId, c.propertyId, q, false);
        const days = otbObservation(facts, q);
        const source = property.source === 'LOCAL' ? 'LOCAL' : 'CLOCK';
        await tx.$executeRaw`INSERT INTO report_otb_snapshots(tenant_id,property_id,snapshot_date,timezone,source) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${today}::date,${property.timezone},${source})`;
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO report_otb_days(tenant_id,property_id,snapshot_date,stay_date,sold,available) VALUES ${Prisma.join(days.map((d) => Prisma.sql`(${c.tenantId}::uuid,${c.propertyId}::uuid,${today}::date,${d.date}::date,${d.sold},${d.available})`))}`,
        );
        const revenue = days.flatMap((d) => d.revenue.map((r) => ({ date: d.date, ...r })));
        if (revenue.length > 36500) throw new Error('Snapshot exceeds 36,500 currency/date cells.');
        for (let offset = 0; offset < revenue.length; offset += 500)
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO report_otb_revenue(tenant_id,property_id,snapshot_date,stay_date,currency,sold,room_revenue_minor) VALUES ${Prisma.join(revenue.slice(offset, offset + 500).map((r) => Prisma.sql`(${c.tenantId}::uuid,${c.propertyId}::uuid,${today}::date,${r.date}::date,${r.currency},${r.sold},${r.minor}::numeric)`))}`,
          );
        await tx.$executeRaw`DELETE FROM report_otb_snapshots WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND snapshot_date<${shiftDay(today, -799)}::date`;
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: null,
          action: 'reports.otb.captured',
          targetType: 'property',
          targetId: c.propertyId,
          details: { snapshotDate: today, days: 365, source, timezone: property.timezone },
        });
        return { captured: true, days: days.length };
      },
      { timeoutMs: 60000, isolationLevel: 'RepeatableRead' },
    );
  }
}

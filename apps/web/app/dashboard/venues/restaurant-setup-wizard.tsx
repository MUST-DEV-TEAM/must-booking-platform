'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { PageHeader } from '../../../components/ui/page-header';
import { Stepper } from '../../../components/ui/stepper';
import { SetupBasicsStep } from './setup-basics-step';
import { SetupDepositStep } from './setup-deposit-step';
import { SetupHoursStep } from './setup-hours-step';
import { SetupRulesStep } from './setup-rules-step';
import { missingSetupSteps, venueApi, type VenueService, type VenueUpdate } from './venue-api';
import { VenueLayoutPanel } from './venue-layout-panel';

const STEPS = [
  { id: 'basics', title: 'Basics', description: 'Name and contact' },
  { id: 'hours', title: 'Opening hours', description: 'When you take bookings' },
  { id: 'tables', title: 'Tables', description: 'Areas and tables' },
  { id: 'rules', title: 'Booking rules', description: 'Who can book, and when' },
  { id: 'deposit', title: 'Deposits', description: 'Optional' },
] as const;

/** Which step a "missing" item from the server belongs to. */
const STEP_OF_MISSING: Record<string, number> = { basics: 0, hours: 1, tables: 2 };
const MISSING_LABEL: Record<string, string> = {
  basics: 'the basics (time zone and currency)',
  hours: 'the opening hours',
  tables: 'at least one table',
};

/**
 * The first-time setup of a restaurant. Each step saves as you go, so you can leave and come back:
 * it opens at the first step that is not done yet. Online booking stays closed until it is finished.
 */
export function RestaurantSetupWizard({
  tenantId,
  venueId,
  onFinished,
}: {
  tenantId: string;
  venueId: string;
  onFinished?: () => void;
}) {
  const client = useQueryClient();
  const venue = useQuery({
    queryKey: ['venue', tenantId, venueId],
    queryFn: () => venueApi.getVenue(tenantId, venueId),
  });
  const services = useQuery({
    queryKey: ['venue-services', tenantId, venueId],
    queryFn: () => venueApi.listServices(tenantId, venueId),
  });
  const layout = useQuery({
    queryKey: ['venue-layout', tenantId, venueId],
    queryFn: () => venueApi.getLayout(tenantId, venueId),
  });
  const [step, setStep] = useState<number | null>(null);
  const [unfinished, setUnfinished] = useState<string | null>(null);

  const tableCount = layout.data?.areas.reduce((sum, area) => sum + area.tables.length, 0) ?? 0;

  // Open at the first step that is not done yet.
  useEffect(() => {
    if (step !== null || !venue.data || !services.data || !layout.data) return;
    if (!venue.data.timezone || !venue.data.currency) setStep(0);
    else if (services.data.length === 0) setStep(1);
    else if (tableCount === 0) setStep(2);
    else setStep(3);
  }, [step, venue.data, services.data, layout.data, tableCount]);

  const saveVenue = useMutation({
    mutationFn: (update: VenueUpdate) => venueApi.updateVenue(tenantId, venueId, update),
    onSuccess: () => client.invalidateQueries({ queryKey: ['venue', tenantId, venueId] }),
  });
  const saveHours = useMutation({
    mutationFn: (rows: VenueService[]) => venueApi.saveServices(tenantId, venueId, rows),
    onSuccess: () => client.invalidateQueries({ queryKey: ['venue-services', tenantId, venueId] }),
  });
  const finish = useMutation({
    mutationFn: () => venueApi.completeSetup(tenantId, venueId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['venue', tenantId, venueId] });
      await client.invalidateQueries({ queryKey: ['venues', tenantId] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
      onFinished?.();
    },
    onError: (error) => {
      const missing = missingSetupSteps(error);
      if (missing.length === 0) return;
      setUnfinished(
        `Please finish ${missing.map((item) => MISSING_LABEL[item] ?? item).join(' and ')} first.`,
      );
      setStep(Math.min(...missing.map((item) => STEP_OF_MISSING[item] ?? 0)));
    },
  });

  if (venue.isPending || services.isPending || layout.isPending || step === null)
    return <p className="text-sm text-muted-foreground">Loading the setupâ€¦</p>;
  if (venue.isError || services.isError || layout.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {(venue.error ?? services.error ?? layout.error)?.message ?? 'Could not load the setup.'}
        </AlertDescription>
      </Alert>
    );

  const next = () => {
    setUnfinished(null);
    setStep((current) => Math.min((current ?? 0) + 1, STEPS.length - 1));
  };
  const back = () => setStep((current) => Math.max((current ?? 0) - 1, 0));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Set up ${venue.data.name}`}
        description="A few quick steps before guests can book. Everything is saved as you go, so you can come back any time."
      />
      <Stepper steps={STEPS} current={step} label="Setup progress" />
      {unfinished ? (
        <Alert variant="warning">
          <AlertDescription>{unfinished}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-label={STEPS[step].title} className="space-y-4">
        <h3 className="text-lg font-semibold">
          Step {step + 1} of {STEPS.length}: {STEPS[step].title}
        </h3>
        {step === 0 ? (
          <SetupBasicsStep
            venue={venue.data}
            saving={saveVenue.isPending}
            error={saveVenue.error?.message}
            onSubmit={async (update) => {
              await saveVenue.mutateAsync(update).then(next, () => undefined);
            }}
          />
        ) : step === 1 ? (
          <SetupHoursStep
            services={services.data}
            saving={saveHours.isPending}
            error={saveHours.error?.message}
            onSubmit={async (rows) => {
              await saveHours.mutateAsync(rows).then(next, () => undefined);
            }}
          />
        ) : step === 2 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add the areas of your restaurant, such as a terrace or a dining room, then the tables
              in each. You can arrange them on a map now or later.
            </p>
            <VenueLayoutPanel tenantId={tenantId} venueId={venueId} initialView="map" />
            {tableCount === 0 ? (
              <p className="text-sm text-muted-foreground">Add at least one table to continue.</p>
            ) : null}
            <Button onClick={next} disabled={tableCount === 0}>
              Continue
            </Button>
          </div>
        ) : step === 3 ? (
          <SetupRulesStep
            venue={venue.data}
            saving={saveVenue.isPending}
            error={saveVenue.error?.message}
            onSubmit={async (update) => {
              await saveVenue.mutateAsync(update).then(next, () => undefined);
            }}
          />
        ) : (
          <SetupDepositStep
            tenantId={tenantId}
            venueId={venueId}
            saving={saveVenue.isPending || finish.isPending}
            error={
              saveVenue.error?.message ??
              (missingSetupSteps(finish.error).length ? null : finish.error?.message)
            }
            onFinish={() => finish.mutate()}
            onSkip={() => finish.mutate()}
          />
        )}
      </section>

      {step > 0 ? (
        <div>
          <Button variant="outline" onClick={back}>
            Back
          </Button>
        </div>
      ) : null}
    </div>
  );
}

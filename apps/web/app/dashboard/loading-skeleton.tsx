import { Card, Stack, Text } from '@must/ui';

export function DashboardLoadingSkeleton({
  label = 'Loading dashboard content…',
}: {
  label?: string;
}) {
  return (
    <section aria-busy="true" aria-label={label}>
      <Stack gap="lg">
        <Text>{label}</Text>
        <Card>
          <div className="must-skeleton" />
          <div className="must-skeleton" />
          <div className="must-skeleton" />
        </Card>
      </Stack>
    </section>
  );
}

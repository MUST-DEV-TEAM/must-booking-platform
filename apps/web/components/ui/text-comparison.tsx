import { Card, CardHeader, CardTitle, CardContent } from './card';
/** Escaped side-by-side text comparison for saved and edited wording. */
export function TextComparison({
  before,
  after,
  beforeLabel = 'Saved version',
  afterLabel = 'Current draft',
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  return (
    <section aria-label="Version comparison" className="grid gap-4 md:grid-cols-2">
      {[
        { label: beforeLabel, value: before },
        { label: afterLabel, value: after },
      ].map((row) => (
        <Card key={row.label}>
          <CardHeader>
            <CardTitle>{row.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="m-0 whitespace-pre-wrap break-words text-sm">{row.value}</pre>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

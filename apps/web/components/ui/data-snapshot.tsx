import { Card, CardContent, CardHeader, CardTitle } from './card';
/** Displays recorded structured evidence as escaped text; missing evidence stays explicit. */
export function DataSnapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {value === null || value === undefined ? (
          <p className="m-0 text-sm text-muted-foreground">Not recorded</p>
        ) : (
          <pre
            aria-label={title}
            className="m-0 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-words"
          >
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

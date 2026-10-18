import { Card, CardContent, CardHeader, CardTitle } from './card';
import { EmptyPanel } from './state-panel';

export type MetricDefinition = {
  key: string;
  label: string;
  formula: string;
  dateBasis: string;
  currencyBasis: string;
  source: string;
  limitations: string;
};

/** Displays server-owned metric definitions without inventing formulas or recalculating figures. */
export function MetricDefinitions({
  definitions,
  timezone,
  basis,
}: {
  definitions: MetricDefinition[];
  timezone: string;
  basis: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        Time zone: {timezone}. {basis}.
      </div>
      {definitions.length ? (
        definitions.map((metric) => (
          <Card key={metric.key}>
            <CardHeader>
              <CardTitle>{metric.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <strong>Formula: </strong>
                {metric.formula}
              </div>
              <div>
                <strong>Date basis: </strong>
                {metric.dateBasis}
              </div>
              <div>
                <strong>Currency: </strong>
                {metric.currencyBasis}
              </div>
              <div className="break-words">
                <strong>Data source: </strong>
                {metric.source}
              </div>
              {metric.limitations ? (
                <div className="text-muted-foreground">{metric.limitations}</div>
              ) : null}
            </CardContent>
          </Card>
        ))
      ) : (
        <EmptyPanel
          title="No metric definitions available"
          description="No definitions are available with your current permissions."
        />
      )}
    </div>
  );
}

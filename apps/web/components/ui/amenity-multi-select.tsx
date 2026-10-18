'use client';

import { useEffect, useState } from 'react';

import { Badge } from './badge';
import { Button } from './button';
import { MultiSelect, type MultiSelectOption } from './multi-select';

/** Amenity selection with searchable icons, reusable suggestions and custom creation. */
export function AmenityMultiSelect({
  options,
  value,
  onChange,
  readOnly = false,
  onCreate,
  suggestions = [],
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void | Promise<void>;
  readOnly?: boolean;
  onCreate?: (name: string, suggestion?: string) => Promise<string | void>;
  suggestions?: MultiSelectOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState(value);
  const [createdOptions, setCreatedOptions] = useState<MultiSelectOption[]>([]);
  const combinedOptions = [
    ...options,
    ...createdOptions.filter((item) => !options.some((option) => option.value === item.value)),
  ];
  const valueKey = JSON.stringify(value);
  useEffect(() => setDraft(JSON.parse(valueKey) as string[]), [valueKey]);
  const selected = combinedOptions.filter((option) => draft.includes(option.value));
  const create = async (name: string, suggestion?: string) => {
    if (!onCreate) return;
    const id = await onCreate(name, suggestion);
    if (id) {
      setCreatedOptions((current) => [
        ...current,
        {
          value: id,
          label: name,
          icon: suggestions.find((item) => item.value === suggestion)?.icon,
        },
      ]);
      setDraft((current) => (current.includes(id) ? current : [...current, id]));
    }
  };

  if (readOnly)
    return selected.length ? (
      <div className="flex flex-wrap gap-2">
        {selected.map((option) => (
          <Badge key={option.value} variant="muted" className="gap-1.5">
            {option.icon}
            {option.label}
          </Badge>
        ))}
      </div>
    ) : (
      <p className="m-0 text-sm text-muted-foreground">No amenities selected.</p>
    );

  const availableSuggestions = suggestions.filter(
    (suggestion) =>
      !options.some(
        (option) => option.label.toLocaleLowerCase() === suggestion.label.toLocaleLowerCase(),
      ),
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <MultiSelect
        label="Amenities"
        placeholder="Choose amenities"
        options={combinedOptions}
        value={draft}
        onChange={setDraft}
        disabled={creating}
        searchable
        onCreateOption={onCreate ? (name) => create(name) : undefined}
        footer={
          onCreate && availableSuggestions.length ? (
            <section aria-label="Suggested amenities" className="flex flex-col gap-2 border-t pt-2">
              <h3 className="m-0 px-2 text-xs font-semibold text-muted-foreground">
                Suggested amenities
              </h3>
              <div className="flex flex-wrap gap-1">
                {availableSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion.value}
                    size="sm"
                    variant="ghost"
                    disabled={creating}
                    onClick={async () => {
                      setCreating(true);
                      setError(undefined);
                      try {
                        await create(suggestion.label, suggestion.value);
                      } catch (error) {
                        setError(
                          error instanceof Error ? error.message : 'Unable to create amenity.',
                        );
                      } finally {
                        setCreating(false);
                      }
                    }}
                  >
                    {suggestion.icon}
                    {suggestion.label}
                  </Button>
                ))}
              </div>
              {error ? (
                <p role="alert" className="m-0 text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </section>
          ) : undefined
        }
      />
      <Button
        className="self-start"
        size="sm"
        disabled={creating || JSON.stringify(draft) === valueKey}
        onClick={async () => {
          setCreating(true);
          setError(undefined);
          try {
            await onChange(draft);
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to save amenities.');
          } finally {
            setCreating(false);
          }
        }}
      >
        Save amenities
      </Button>
      {error ? (
        <p role="alert" className="m-0 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { EmptyPanel } from '../../../components/ui/state-panel';
import { Input, Textarea } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import type { RoomCategory } from './room-management-types';

/** Category controls for accommodation room types, built from shared dashboard controls. */
export function RoomCategoriesPanel({
  categories,
  canManage,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}: {
  categories: RoomCategory[];
  canManage: boolean;
  saving: boolean;
  onCreate: (value: { name: string; description: string }) => void;
  onUpdate: (id: string, value: Partial<RoomCategory>) => void;
  onDelete: (category: RoomCategory) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({});

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onReorder(reordered.map((category) => category.id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Room categories</CardTitle>
        <CardDescription>
          Group room types for guests and choose their storefront order and visibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canManage ? (
          <form
            className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_auto] md:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              onCreate({ name: name.trim(), description: description.trim() });
              setName('');
              setDescription('');
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-medium">
              Category name
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Description
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={1}
              />
            </label>
            <Button type="submit" disabled={!name.trim() || saving} loading={saving}>
              <Plus aria-hidden="true" /> Add category
            </Button>
          </form>
        ) : null}
        {categories.length ? (
          <div className="flex flex-col gap-2">
            {categories.map((category, index) => {
              const draft = drafts[category.id] ?? {
                name: category.name,
                description: category.description ?? '',
              };
              return (
                <div
                  key={category.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {editing === category.id ? (
                      <>
                        <Input
                          aria-label={`${category.name} category name`}
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [category.id]: { ...draft, name: event.target.value },
                            }))
                          }
                        />
                        <Textarea
                          aria-label={`${category.name} category description`}
                          value={draft.description}
                          rows={2}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [category.id]: { ...draft, description: event.target.value },
                            }))
                          }
                        />
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{category.name}</span>
                          <Badge variant="muted">{category.roomCount} room types</Badge>
                          <Badge variant={category.storefrontVisible ? 'success' : 'muted'}>
                            {category.storefrontVisible ? 'Visible' : 'Hidden'}
                          </Badge>
                        </div>
                        <p className="m-0 text-sm text-muted-foreground">
                          {category.description || 'No category description.'}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={category.storefrontVisible}
                        disabled={!canManage || saving}
                        aria-label={`${category.name} visible in storefront`}
                        onCheckedChange={(storefrontVisible) =>
                          onUpdate(category.id, { storefrontVisible })
                        }
                      />
                      Storefront visible
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Move ${category.name} up`}
                      disabled={!canManage || saving || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Move ${category.name} down`}
                      disabled={!canManage || saving || index === categories.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    {editing === category.id ? (
                      <Button
                        disabled={!canManage || saving || !draft.name.trim()}
                        loading={saving}
                        onClick={() => {
                          onUpdate(category.id, draft);
                          setEditing(null);
                        }}
                      >
                        <Save aria-hidden="true" /> Save
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={!canManage || saving}
                        onClick={() => setEditing(category.id)}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Delete ${category.name}`}
                      disabled={!canManage || saving}
                      onClick={() => onDelete(category)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyPanel
            title="No categories yet"
            description="Add categories to organize room types on the storefront."
          />
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import {
  Button,
  NavigationPagination,
  NavigationSectionTabBar,
  NavigationSectionTabItem,
  TextInput,
} from '@must/ui';
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DayPicker } from 'react-day-picker';

import { interactiveStates, Section, Specimen, StateGrid, type StateColumn } from './specimens';
import styles from './styleguide.module.css';

const buttonVariants = ['primary', 'secondary', 'danger', 'ghost'] as const;
const inputStates: readonly StateColumn[] = [
  { label: 'Default' },
  { label: 'Hover', forced: 'hover' },
  { label: 'Focus', forced: 'focus' },
  { label: 'Disabled', disabled: true },
];

const searchStates = [
  { label: 'Default', forced: undefined },
  { label: 'Hover', forced: 'hover' },
  { label: 'Focus', forced: 'focus' },
  { label: 'Filled', forced: undefined, value: 'Rossi' },
  { label: 'Loading', forced: undefined, value: 'Rossi', loading: true },
  { label: 'Error', forced: undefined, value: 'Rossi', error: 'Search is unavailable. Try again.' },
  { label: 'Disabled', forced: undefined, disabled: true },
] as const;

function SearchField({
  className,
  value,
  loading,
  error,
  disabled,
}: {
  className?: string;
  value?: string;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  let endAdornment: ReactNode = null;
  if (loading) endAdornment = <Loader2 aria-hidden="true" className={styles.spin} size={16} />;
  else if (value)
    endAdornment = (
      <button aria-label="Clear search" className={styles.clearButton} type="button">
        <X aria-hidden="true" size={14} />
      </button>
    );
  return (
    <TextInput
      className={className}
      defaultValue={value}
      disabled={disabled}
      endAdornment={endAdornment}
      error={error}
      label="Search bookings"
      placeholder="Search…"
      startAdornment={<Search size={16} />}
      type="search"
    />
  );
}

export function FormControls() {
  const [range] = useState({ from: new Date(2026, 9, 12), to: new Date(2026, 9, 15) });
  const [day] = useState(new Date(2026, 9, 21));

  return (
    <>
      <Section
        id="buttons"
        title="Buttons"
        description="Hover, focus and active are forced so every state is visible at once."
      >
        <Specimen title="Variants and states" note="Four variants from @must/ui.">
          {buttonVariants.map((variant) => (
            <div className={styles.variantRow} key={variant}>
              <span className={styles.variantLabel}>{variant}</span>
              <StateGrid
                columns={interactiveStates}
                render={(state, className) => (
                  <Button className={className} disabled={state.disabled} variant={variant}>
                    {variant === 'danger' ? 'Delete' : 'Save'}
                  </Button>
                )}
              />
            </div>
          ))}
        </Specimen>
        <Specimen
          title="With an icon"
          note="Icon before the label, or an icon-only button (which must carry an aria-label)."
        >
          <div className={styles.inlineRow}>
            <Button>
              <Plus aria-hidden="true" size={16} /> Add room type
            </Button>
            <Button variant="secondary">
              <Plus aria-hidden="true" size={16} /> Add room type
            </Button>
            <Button variant="danger">
              <Trash2 aria-hidden="true" size={16} /> Delete
            </Button>
            <Button aria-label="Close" variant="ghost">
              <X aria-hidden="true" size={16} />
            </Button>
          </div>
        </Specimen>
      </Section>

      <Section
        id="text-input"
        title="Text input"
        description="TextInput from @must/ui: label, hint, error and adornments."
      >
        <Specimen title="States">
          <StateGrid
            columns={inputStates}
            render={(state, className) => (
              <TextInput
                className={className}
                defaultValue="Empire Beach Resort"
                disabled={state.disabled}
                label="Property name"
              />
            )}
          />
        </Specimen>
        <Specimen title="Content and validation">
          <div className={styles.stateGrid}>
            <div className={styles.stateCell}>
              <span className={styles.stateLabel}>Empty with placeholder</span>
              <TextInput label="Guest email" placeholder="name@example.com" />
            </div>
            <div className={styles.stateCell}>
              <span className={styles.stateLabel}>With hint</span>
              <TextInput hint="We only use this for the booking." label="Phone" />
            </div>
            <div className={styles.stateCell}>
              <span className={styles.stateLabel}>Error</span>
              <TextInput
                defaultValue="not-an-email"
                error="Enter a valid email address."
                label="Email"
              />
            </div>
            <div className={styles.stateCell}>
              <span className={styles.stateLabel}>Read only</span>
              <TextInput defaultValue="BK-20841" label="Booking ID" readOnly />
            </div>
          </div>
        </Specimen>
      </Section>

      <Section
        id="search-field"
        title="Search field"
        description="A pattern built from TextInput (search icon, clear button, spinner). There is no shared SearchField component yet."
      >
        <Specimen title="States">
          <div className={styles.stateGrid}>
            {searchStates.map((state) => (
              <div className={styles.stateCell} key={state.label}>
                <span className={styles.stateLabel}>{state.label}</span>
                <SearchField
                  className={state.forced ? `sg-${state.forced}` : undefined}
                  disabled={'disabled' in state ? state.disabled : undefined}
                  error={'error' in state ? state.error : undefined}
                  loading={'loading' in state ? state.loading : undefined}
                  value={'value' in state ? state.value : undefined}
                />
              </div>
            ))}
          </div>
        </Specimen>
      </Section>

      <Section
        id="select"
        title="Select"
        description="There is no shared Select component; screens use a native select with the must-input class."
      >
        <Specimen title="States">
          <StateGrid
            columns={inputStates}
            render={(state, className) => (
              <label className="must-field">
                <span className="must-field__label">Room type</span>
                <select
                  className={`must-input ${className ?? ''}`}
                  defaultValue="deluxe"
                  disabled={state.disabled}
                >
                  <option value="deluxe">Deluxe Suite Sea View</option>
                  <option value="junior">Junior Suite Sea View</option>
                </select>
              </label>
            )}
          />
          <div className={styles.stateGrid}>
            <label className="must-field">
              <span className="must-field__label">Error</span>
              <select aria-invalid="true" className="must-input must-input--error" defaultValue="">
                <option value="">Select a room type</option>
                <option value="deluxe">Deluxe Suite Sea View</option>
              </select>
              <span className="must-field__error" role="alert">
                Choose a room type.
              </span>
            </label>
          </div>
        </Specimen>
      </Section>

      <Section
        id="choice-controls"
        title="Checkbox and radio"
        description="No shared component yet; native controls are used and inherit the page font."
      >
        <Specimen title="States">
          <div className={styles.stateGrid}>
            <label className={styles.nativeControl}>
              <input type="checkbox" /> Unchecked
            </label>
            <label className={styles.nativeControl}>
              <input type="checkbox" defaultChecked /> Checked
            </label>
            <label className={styles.nativeControl}>
              <input type="checkbox" disabled /> Disabled
            </label>
            <label className={styles.nativeControl}>
              <input type="checkbox" disabled defaultChecked /> Disabled checked
            </label>
            <label className={styles.nativeControl}>
              <input name="sg-radio" type="radio" defaultChecked /> Radio selected
            </label>
            <label className={styles.nativeControl}>
              <input name="sg-radio" type="radio" /> Radio
            </label>
          </div>
        </Specimen>
      </Section>

      <Section
        id="date-picker"
        title="Date picker"
        description="react-day-picker, themed through the accent tokens; used by Quick Booking and the calendar."
      >
        <Specimen
          title="Range selected"
          note="Start and end use the accent; the days between use the accent tint."
        >
          <DayPicker
            defaultMonth={new Date(2026, 9)}
            labels={{ labelNav: () => 'Range picker months' }}
            mode="range"
            selected={range}
          />
        </Specimen>
        <Specimen
          title="Single day, past days disabled"
          note="Disabled days are dimmed and not selectable; days outside the month are shown quietly."
        >
          <DayPicker
            defaultMonth={new Date(2026, 9)}
            disabled={{ before: new Date(2026, 9, 10) }}
            labels={{ labelNav: () => 'Single day picker months' }}
            mode="single"
            selected={day}
            showOutsideDays
          />
        </Specimen>
      </Section>

      <Section
        id="tabs-pagination"
        title="Tabs and pagination"
        description="NavigationSectionTabBar and NavigationPagination from @must/ui."
      >
        <Specimen title="Section tabs">
          <NavigationSectionTabBar label="Example tabs">
            <NavigationSectionTabItem current href="#tabs-pagination" label="Current" />
            <NavigationSectionTabItem href="#tabs-pagination" label="Other" />
            <NavigationSectionTabItem href="#tabs-pagination" label="Another" />
          </NavigationSectionTabBar>
        </Specimen>
        <Specimen
          title="Pagination"
          note="First page (Previous disabled), a middle page, and the last page (Next disabled)."
        >
          <NavigationPagination
            label="First page"
            onPageChange={() => undefined}
            page={1}
            pageSize={10}
            total={45}
          />
          <NavigationPagination
            label="Middle page"
            onPageChange={() => undefined}
            page={3}
            pageSize={10}
            total={45}
          />
          <NavigationPagination
            label="Last page"
            onPageChange={() => undefined}
            page={5}
            pageSize={10}
            total={45}
          />
        </Specimen>
      </Section>
    </>
  );
}

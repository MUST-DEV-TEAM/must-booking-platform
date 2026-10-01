'use client';

import { Button, Card, Heading, Stack, Text } from '@must/ui';

import { Section, Specimen } from './specimens';
import styles from './styleguide.module.css';

const gaps = ['sm', 'md', 'lg'] as const;

function Block({ label }: { label: string }) {
  return <span className={styles.stackBlock}>{label}</span>;
}

export function TextAndHeadings() {
  return (
    <Section
      id="headings-text"
      title="Headings and text"
      description="Heading and Text from @must/ui. Use the level that matches the page outline, not the size you want."
    >
      <Specimen
        title="Heading levels"
        note="Levels 1 to 3. Display sizes for KPI numerals are not a heading."
      >
        <Stack gap="sm">
          <Heading level={1}>Heading level 1 — page title</Heading>
          <Heading level={2}>Heading level 2 — section title</Heading>
          <Heading level={3}>Heading level 3 — panel title</Heading>
        </Stack>
      </Specimen>
      <Specimen title="Text tones">
        <Stack gap="sm">
          <Text>Text primary — default body copy for content people read and act on.</Text>
          <Text tone="secondary">
            Text secondary — supporting descriptions and hints that can be skimmed.
          </Text>
        </Stack>
      </Specimen>
      <Specimen
        title="Long content"
        note="A long heading and a long paragraph show how text wraps inside a narrow column."
      >
        <div className={styles.narrow}>
          <Heading level={3}>
            Deluxe Suite with Jacuzzi and Private Garden Entrance, Sea View
          </Heading>
          <Text tone="secondary">
            Booking confirmations are sent to the guest and to every staff member assigned to the
            property as soon as payment completes, so nobody has to refresh a list to see it.
          </Text>
        </div>
      </Specimen>
    </Section>
  );
}

export function Cards() {
  return (
    <Section
      id="cards"
      title="Cards"
      description="Card from @must/ui, the shared surface for grouped content."
    >
      <Specimen title="Basic">
        <Card>
          <Heading level={3}>Card title</Heading>
          <Text tone="secondary">Card body content sits on the surface token.</Text>
        </Card>
      </Specimen>
      <Specimen
        title="With an action"
        note="Card has no built-in spacing between its children: wrap them in a Stack, as here."
      >
        <Card>
          <Stack>
            <Heading level={3}>Room types</Heading>
            <Text tone="secondary">14 room types are configured for this property.</Text>
            <div className={styles.inlineRow}>
              <Button>Add room type</Button>
              <Button variant="secondary">Manage photo library</Button>
            </div>
          </Stack>
        </Card>
      </Specimen>
      <Specimen
        title="Nested content"
        note="Cards do not nest; use a divided list inside one card instead."
      >
        <Card>
          <Heading level={3}>Today</Heading>
          <ul className={styles.dividedList}>
            <li>
              <strong>Maria Rossi</strong>
              <span>Deluxe Suite · Arrives 15:00</span>
            </li>
            <li>
              <strong>Jonas Weber</strong>
              <span>Junior Suite · Departs 11:00</span>
            </li>
            <li>
              <strong>Elena Petrova</strong>
              <span>Standard Double · In house</span>
            </li>
          </ul>
        </Card>
      </Specimen>
      <Specimen title="Long content" note="Content wraps; the card grows with it.">
        <div className={styles.narrow}>
          <Card>
            <Heading level={3}>
              A card with a rather long title that has to wrap onto a second line
            </Heading>
            <Text tone="secondary">
              Cards never truncate their content silently. If something is too long it wraps, and if
              it must be shortened the full text is available on demand.
            </Text>
          </Card>
        </div>
      </Specimen>
    </Section>
  );
}

export function StackSpacing() {
  return (
    <Section
      id="stack"
      title="Stack"
      description="Stack from @must/ui arranges children vertically with a consistent gap."
    >
      <Specimen title="Gaps" note="sm = 8px, md = 16px (default), lg = 24px between children.">
        <div className={styles.stackGaps}>
          {gaps.map((gap) => (
            <div key={gap}>
              <span className={styles.stateLabel}>gap = {gap}</span>
              <Stack gap={gap}>
                <Block label="One" />
                <Block label="Two" />
                <Block label="Three" />
              </Stack>
            </div>
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

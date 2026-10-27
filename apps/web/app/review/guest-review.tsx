'use client';

import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Textarea } from '../../components/ui/input';
import { RatingInput } from '../../components/ui/rating-input';

type Form = {
  hotel: {
    name: string;
    logoUrl: string | null;
    brandColour: string | null;
    websiteUrl: string | null;
  };
  guestFirstName: string | null;
  stay: { startsOn: string; endsOn: string };
  categories: Array<{ key: string; label: string }>;
  alreadySubmitted: boolean;
};

type Problem = { title: string; text: string };

const COMMENT_MAX = 2000;

function day(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

/** The private page a guest reaches from the email: rate the stay, add a few words, done. */
export function GuestReview() {
  const [form, setForm] = useState<Form | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [overall, setOverall] = useState<number | null>(null);
  const [aspects, setAspects] = useState<Record<string, number | null>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [target, setTarget] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const tenant = query.get('tenant');
    const property = query.get('property');
    const token = query.get('token');
    if (!tenant || !property || !token) {
      setProblem({
        title: 'This link is incomplete',
        text: 'Please use the button in the email we sent you.',
      });
      return;
    }
    const url = `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/reviews?token=${encodeURIComponent(token)}`;
    setTarget(url);
    let active = true;
    void fetch(url, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<Form> & {
          message?: string;
        };
        if (!active) return;
        if (response.status === 410)
          setProblem({
            title: 'This link has expired',
            text: body.message ?? 'Thank you for staying with us.',
          });
        else if (!response.ok)
          setProblem({
            title: 'We could not open this page',
            text: 'The link may be mistyped. Please use the button in the email we sent you.',
          });
        else {
          setForm(body as Form);
          if ((body as Form).alreadySubmitted) setDone(true);
        }
      })
      .catch(() => {
        if (active)
          setProblem({
            title: 'We could not open this page',
            text: 'Please check your connection and try again.',
          });
      });
    return () => {
      active = false;
    };
  }, []);

  const send = async () => {
    if (!overall || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(target, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overall,
          categories: Object.fromEntries(
            Object.entries(aspects).filter(([, score]) => score !== null),
          ),
          comment: comment.trim() || null,
        }),
      });
      if (response.status === 409) setDone(true);
      else if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Your review could not be sent. Please try again.');
      } else setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your review could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const accent = form?.hotel.brandColour ?? undefined;

  return (
    <main
      className="min-h-screen bg-muted/30 px-4 py-8 sm:py-12"
      style={
        accent
          ? ({ '--primary': accent, '--primary-hover': accent } as React.CSSProperties)
          : undefined
      }
    >
      <div className="mx-auto w-full max-w-xl space-y-6">
        {form ? (
          <header className="flex flex-col items-center gap-2 pt-4 text-center">
            {form.hotel.logoUrl ? (
              // The hotel's own logo; its size is unknown, so it is only bounded.
              <img src={form.hotel.logoUrl} alt="" className="max-h-20 w-auto" />
            ) : null}
            <p className="m-0 text-sm font-semibold tracking-wide text-muted-foreground">
              {form.hotel.name}
            </p>
          </header>
        ) : null}

        {problem ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
                <TriangleAlert aria-hidden="true" className="size-6" />
              </span>
              <h1 className="m-0 text-xl font-bold">{problem.title}</h1>
              <p className="m-0 max-w-sm text-sm text-muted-foreground">{problem.text}</p>
            </CardContent>
          </Card>
        ) : null}

        {form && done ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-success-surface text-success">
                <CircleCheck aria-hidden="true" className="size-8" />
              </span>
              <h1 className="m-0 text-2xl font-bold">
                Thank you{form.guestFirstName ? `, ${form.guestFirstName}` : ''}!
              </h1>
              <p className="m-0 max-w-sm text-muted-foreground">
                Your review has been sent to the team at {form.hotel.name}. It helps us make every
                stay a little better. We hope to welcome you again.
              </p>
              {form.hotel.websiteUrl ? (
                <Button variant="outline" asChild>
                  <a href={form.hotel.websiteUrl}>Back to {form.hotel.name}</a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {form && !done ? (
          <Card>
            <CardContent className="space-y-8 py-8">
              <div className="space-y-2 text-center">
                <h1 className="m-0 text-2xl font-bold">How was your stay?</h1>
                <p className="m-0 text-sm text-muted-foreground">
                  {form.guestFirstName ? `Hi ${form.guestFirstName}, thank you` : 'Thank you'} for
                  staying with us from {day(form.stay.startsOn)} to {day(form.stay.endsOn)}. It
                  takes about a minute.
                </p>
              </div>

              <div className="flex flex-col items-center gap-2">
                <RatingInput
                  label="Overall experience"
                  value={overall}
                  onChange={setOverall}
                  size="lg"
                  showWord
                  className="items-center"
                />
              </div>

              <section aria-labelledby="aspects" className="space-y-4">
                <div>
                  <h2 id="aspects" className="m-0 text-base font-bold">
                    Tell us more
                  </h2>
                  <p className="m-0 text-sm text-muted-foreground">
                    Rate whatever you like. You can skip any of these.
                  </p>
                </div>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {form.categories.map((category) => (
                    <li
                      key={category.key}
                      className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                    >
                      <span className="text-sm font-semibold">{category.label}</span>
                      <RatingInput
                        label={category.label}
                        value={aspects[category.key] ?? null}
                        onChange={(score) =>
                          setAspects((current) => ({ ...current, [category.key]: score }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>

              <FormField
                label="Anything you would like to add?"
                htmlFor="review-comment"
                hint={`Optional. ${comment.length}/${COMMENT_MAX}`}
              >
                <Textarea
                  id="review-comment"
                  rows={5}
                  maxLength={COMMENT_MAX}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="What did you enjoy? What could we do better?"
                />
              </FormField>

              {error ? (
                <p role="alert" className="m-0 rounded-lg border border-destructive/30 p-3 text-sm">
                  {error}
                </p>
              ) : null}

              <div className="space-y-2">
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!overall || busy}
                  onClick={() => void send()}
                >
                  {busy ? 'Sending…' : 'Send my review'}
                </Button>
                {!overall ? (
                  <p className="m-0 text-center text-xs text-muted-foreground">
                    Choose an overall score to send your review.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!form && !problem ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Opening your review…
            </CardContent>
          </Card>
        ) : null}

        <p className="m-0 text-center text-xs text-muted-foreground">
          Your review is read by the hotel team and is not shown publicly.
        </p>
      </div>
    </main>
  );
}

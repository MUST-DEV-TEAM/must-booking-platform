type Quote = {
  quoteToken: string;
  date: string;
  time: string;
  durationMinutes: number;
  amount: string;
  currency: string;
  freeCancelHours: number;
  areaName: string;
};
type Layout = {
  areas: Array<{
    id: string;
    name: string;
    mapWidth: number;
    mapHeight: number;
    tables: Array<{
      id: string;
      label: string;
      minSeats: number;
      maxSeats: number;
      mapX: number;
      mapY: number;
      mapWidth: number;
      mapHeight: number;
      shape: string;
    }>;
  }>;
};
type Slot = { time: string; freeTableIds: string[] };
type Mode = 'auto' | 'choose' | 'map';
type Reservation = {
  id: string;
  reference: string;
  status: string;
  startsAt: string;
  endsAt: string;
  checkout?: { url: string } | null;
  accessToken?: string;
  paymentHoldExpiresAt?: string | null;
};
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const api = element('booking-app').dataset.api!;
const message = element('message');
const find = element<HTMLFormElement>('find-form');
const guest = element<HTMLFormElement>('guest-form');
const findButton = element<HTMLButtonElement>('find-button');
const bookButton = element<HTMLButtonElement>('book-button');
let quote: Quote | undefined;
let booking: Reservation | undefined;
let attempt: Record<string, unknown> | undefined;
let timezone = 'UTC';
let poll: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let mode: Mode = 'auto';
let layout: Layout | undefined;
let currentSlot: Slot | undefined;
const pick = element('pick');
const dialog = element<HTMLDialogElement>('table-dialog');
const guestSlot = element('guest-slot');
const NS = 'http://www.w3.org/2000/svg';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join(' ')
        : (data.message ?? 'Please try again in a moment.'),
    );
  return data as T;
}
const selection = () => ({
  date: element<HTMLInputElement>('date').value,
  partySize: Number(element<HTMLInputElement>('party').value),
  durationMinutes: Number(element<HTMLSelectElement>('duration').value),
});
const showError = (error: unknown) => {
  message.textContent =
    error instanceof Error ? error.message : 'We could not connect. Please try again.';
};
findButton.disabled = true;
request<{
  name: string;
  timezone: string;
  maxPartySize: number;
  diningMinutes: number;
  advanceBookingDays: number;
}>('')
  .then((info) => {
    timezone = info.timezone;
    const name = document.getElementById('restaurant-name');
    if (name) name.textContent = `Live availability · ${info.name}`;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const date = element<HTMLInputElement>('date');
    date.min = date.value = today;
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + info.advanceBookingDays);
    date.max = end.toISOString().slice(0, 10);
    element<HTMLInputElement>('party').max = String(info.maxPartySize);
    const duration = element<HTMLSelectElement>('duration');
    if (![...duration.options].some((option) => option.value === String(info.diningMinutes)))
      duration.add(new Option(`${info.diningMinutes} minutes`, String(info.diningMinutes)));
    duration.value = String(info.diningMinutes);
    findButton.disabled = false;
  })
  .catch(showError);

find.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (attempt) return;
  const version = ++revision;
  quote = undefined;
  guest.hidden = true;
  message.textContent = 'Looking for your table…';
  findButton.disabled = true;
  element('slots').replaceChildren();
  element('times').hidden = true;
  try {
    const data = await request<{
      services: Array<{ name: string; slots: Slot[] }>;
    }>(
      `/availability?${new URLSearchParams(Object.entries(selection()).map(([key, value]) => [key, String(value)]))}`,
    );
    if (version !== revision) return;
    for (const service of data.services) {
      if (!service.slots.length) continue;
      const group = document.createElement('div');
      group.className = 'service-slots';
      group.style.flexBasis = '100%';
      const label = document.createElement('p');
      label.textContent = service.name;
      group.append(label);
      for (const slot of service.slots) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'slot';
        button.textContent = slot.time;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          for (const item of element('slots').querySelectorAll('button'))
            item.setAttribute('aria-pressed', String(item === button));
          void chooseSlot(slot);
        });
        group.append(button);
      }
      element('slots').append(group);
    }
    element('times').hidden = false;
    message.textContent = data.services.some((service) => service.slots.length)
      ? ''
      : 'No tables are available for this stay. Try another day, party size or duration.';
  } catch (error) {
    showError(error);
  } finally {
    findButton.disabled = false;
  }
});
for (const input of find.querySelectorAll('input,select'))
  input.addEventListener('change', () => {
    revision += 1;
    quote = undefined;
    guest.hidden = true;
    element('times').hidden = true;
    hidePick();
  });
element('change-time').addEventListener('click', () => {
  if (attempt) return;
  if (dialog.open) {
    dialog.close();
    return;
  }
  guest.hidden = true;
  element('times').scrollIntoView({ block: 'center', behavior: 'smooth' });
});

function hidePick() {
  pick.hidden = true;
  currentSlot = undefined;
  element('choose').hidden = true;
  element('map-panel').hidden = true;
}
function setMode(next: Mode) {
  if (attempt || next === mode) return;
  mode = next;
  revision += 1;
  quote = undefined;
  guest.hidden = true;
  hidePick();
  for (const tab of element('modes').querySelectorAll<HTMLButtonElement>('button'))
    tab.setAttribute('aria-selected', String(tab.dataset.mode === next));
  for (const item of element('slots').querySelectorAll('button'))
    item.setAttribute('aria-pressed', 'false');
  message.textContent = '';
}
for (const tab of element('modes').querySelectorAll<HTMLButtonElement>('button'))
  tab.addEventListener('click', () => setMode(tab.dataset.mode as Mode));

async function loadLayout() {
  layout ??= await request<Layout>('/layout');
  return layout;
}
function tableName(id?: string) {
  const table = layout?.areas.flatMap((area) => area.tables).find((item) => item.id === id);
  return table ? ` · ${table.label}` : '';
}
async function requestQuote(time: string, extra: { tableId?: string }) {
  const version = ++revision;
  message.textContent = 'Checking your booking terms…';
  guest.hidden = true;
  quote = undefined;
  try {
    const next = await request<Quote>('/quote', {
      method: 'POST',
      body: JSON.stringify({ ...selection(), time, ...extra }),
    });
    if (version !== revision) return;
    quote = next;
    element('terms').textContent =
      `${quote.date} at ${quote.time} · ${selection().partySize} guests · ${quote.durationMinutes} minutes · ${quote.areaName}${tableName(extra.tableId)}. ${Number(quote.amount) === 0 ? 'No deposit required.' : `${quote.amount} ${quote.currency} deposit, credited towards your bill. Free cancellation until ${quote.freeCancelHours} hours before arrival.`}`;
    if (mode === 'map') {
      element('dialog-body').append(guest);
      if (!dialog.open) dialog.showModal();
    } else guestSlot.append(guest);
    guest.hidden = false;
    message.textContent = '';
  } catch (error) {
    showError(error);
  }
}
async function chooseSlot(slot: Slot) {
  quote = undefined;
  guest.hidden = true;
  currentSlot = slot;
  if (mode === 'auto') {
    hidePick();
    await requestQuote(slot.time, {});
    return;
  }
  message.textContent = 'Loading the floor…';
  try {
    await loadLayout();
  } catch (error) {
    showError(error);
    return;
  }
  message.textContent = '';
  pick.hidden = false;
  element('choose').hidden = mode !== 'choose';
  element('map-panel').hidden = mode !== 'map';
  const free = new Set(slot.freeTableIds);
  const areaSelect = element<HTMLSelectElement>(mode === 'map' ? 'map-area' : 'area-select');
  const areas = (layout as Layout).areas.filter((area) =>
    mode === 'map' ? true : area.tables.some((table) => free.has(table.id)),
  );
  areaSelect.replaceChildren(
    ...areas.map((area) => {
      const count = area.tables.filter((table) => free.has(table.id)).length;
      return new Option(`${area.name} · ${count} free`, area.id);
    }),
  );
  if (!areas.length) {
    message.textContent = 'No tables are free at this time. Try another time.';
    return;
  }
  renderArea();
}
function renderArea() {
  if (!currentSlot || !layout) return;
  const free = new Set(currentSlot.freeTableIds);
  if (mode === 'choose') {
    const area = layout.areas.find(
      (item) => item.id === element<HTMLSelectElement>('area-select').value,
    );
    element<HTMLSelectElement>('table-select').replaceChildren(
      new Option('Choose a table', ''),
      ...(area?.tables ?? [])
        .filter((table) => free.has(table.id))
        .map(
          (table) =>
            new Option(
              `${table.label} · ${table.minSeats === table.maxSeats ? table.maxSeats : `${table.minSeats}–${table.maxSeats}`} guests`,
              table.id,
            ),
        ),
    );
    return;
  }
  const area = layout.areas.find(
    (item) => item.id === element<HTMLSelectElement>('map-area').value,
  );
  const svg = element('map');
  svg.replaceChildren();
  if (!area) return;
  // Zoom to where the tables are, so a sparse canvas still reads clearly.
  const pad = 30;
  const minX = Math.max(0, Math.min(...area.tables.map((t) => t.mapX)) - pad);
  const minY = Math.max(0, Math.min(...area.tables.map((t) => t.mapY)) - pad);
  const maxX = Math.max(...area.tables.map((t) => t.mapX + t.mapWidth)) + pad;
  const maxY = Math.max(...area.tables.map((t) => t.mapY + t.mapHeight)) + pad;
  const width = Math.max(maxX - minX, 360);
  const height = Math.max(maxY - minY, 240);
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  for (const table of area.tables) {
    const open = free.has(table.id);
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', open ? 'table free' : 'table taken');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-disabled', String(!open));
    group.setAttribute(
      'aria-label',
      `${table.label}, up to ${table.maxSeats} guests, ${open ? 'free' : 'not available'}`,
    );
    if (open) group.setAttribute('tabindex', '0');
    const round = table.shape === 'round';
    const shape = document.createElementNS(NS, round ? 'ellipse' : 'rect');
    if (round) {
      shape.setAttribute('cx', String(table.mapX + table.mapWidth / 2));
      shape.setAttribute('cy', String(table.mapY + table.mapHeight / 2));
      shape.setAttribute('rx', String(table.mapWidth / 2));
      shape.setAttribute('ry', String(table.mapHeight / 2));
    } else {
      shape.setAttribute('x', String(table.mapX));
      shape.setAttribute('y', String(table.mapY));
      shape.setAttribute('width', String(table.mapWidth));
      shape.setAttribute('height', String(table.mapHeight));
      shape.setAttribute('rx', '10');
    }
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', String(table.mapX + table.mapWidth / 2));
    text.setAttribute('y', String(table.mapY + table.mapHeight / 2 - 2));
    text.setAttribute('text-anchor', 'middle');
    const size = Math.max(9, Math.min(20, table.mapWidth / 3.5));
    text.setAttribute('font-size', String(size));
    text.textContent = table.label.replace(/^.*\s(\d+)$/, 'T$1');
    const seats = document.createElementNS(NS, 'text');
    seats.setAttribute('x', String(table.mapX + table.mapWidth / 2));
    seats.setAttribute('y', String(table.mapY + table.mapHeight / 2 + size * 0.8));
    seats.setAttribute('text-anchor', 'middle');
    seats.setAttribute('class', 'seats');
    seats.setAttribute('font-size', String(size * 0.75));
    seats.textContent = `${table.maxSeats} seats`;
    group.append(shape, text, seats);
    if (open) {
      const activate = () => {
        if (currentSlot) void requestQuote(currentSlot.time, { tableId: table.id });
      };
      group.addEventListener('click', activate);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
    }
    svg.append(group);
  }
}
element('area-select').addEventListener('change', renderArea);
element('map-area').addEventListener('change', renderArea);
element('table-select').addEventListener('change', () => {
  const id = element<HTMLSelectElement>('table-select').value;
  if (!id || !currentSlot) {
    guest.hidden = true;
    quote = undefined;
    return;
  }
  void requestQuote(currentSlot.time, { tableId: id });
});
dialog.addEventListener('close', () => {
  if (attempt) return;
  guest.hidden = true;
  quote = undefined;
  guestSlot.append(guest);
});
element('dialog-close').addEventListener('click', () => dialog.close());

function showReservation(value: Reservation) {
  booking = { ...booking, ...value };
  find.hidden = guest.hidden = element('times').hidden = true;
  hidePick();
  if (dialog.open) dialog.close();
  guestSlot.append(guest);
  element('modes').hidden = true;
  element('result').hidden = false;
  element('result-title').textContent =
    booking.status === 'confirmed'
      ? 'You’re on the list.'
      : booking.status === 'pending_payment'
        ? 'Your table is on hold.'
        : 'Your reservation has ended.';
  element('reference').textContent = `Booking reference: ${booking.reference}`;
  const format = (value: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  element('booking-window').textContent = `${format(booking.startsAt)} – ${format(booking.endsAt)}`;
  const pending = booking.status === 'pending_payment';
  const expired =
    !!booking.paymentHoldExpiresAt && Date.parse(booking.paymentHoldExpiresAt) <= Date.now();
  const checkout = element<HTMLAnchorElement>('checkout');
  checkout.hidden = !pending || expired || !booking.checkout?.url;
  if (!checkout.hidden) {
    const target = new URL(booking.checkout!.url);
    if (target.protocol === 'https:') checkout.href = target.href;
    else checkout.hidden = true;
  }
  element('payment-status').textContent = pending
    ? expired
      ? 'The payment hold has expired. This table is no longer held for you.'
      : `Complete the deposit to confirm your table.${booking.paymentHoldExpiresAt ? ` Held until ${format(booking.paymentHoldExpiresAt)}.` : ''}`
    : '';
  element('status-button').hidden = !pending || expired;
  clearTimeout(poll);
  if (pending && !expired)
    poll = setTimeout(() => {
      void refreshStatus();
    }, 5000);
}
async function refreshStatus() {
  if (!booking?.accessToken) return;
  try {
    const current = await request<Reservation>(`/reservations/${booking.id}`, {
      headers: { Authorization: `Bearer ${booking.accessToken}` },
    });
    showReservation(current);
    message.textContent = '';
  } catch (error) {
    showError(error);
  }
}
element('status-button').addEventListener('click', () => {
  void refreshStatus();
});
guest.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!quote || bookButton.disabled) return;
  if (!attempt && !String(new FormData(guest).get('guestName') ?? '').trim()) {
    message.textContent = 'Please enter your name.';
    return;
  }
  attempt ??= { quoteToken: quote.quoteToken, ...Object.fromEntries(new FormData(guest)) };
  for (const control of [...find.elements, ...guest.elements])
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLButtonElement
    )
      control.disabled = true;
  message.textContent = 'Reserving your table…';
  try {
    showReservation(
      await request<Reservation>('/reservations', {
        method: 'POST',
        body: JSON.stringify(attempt),
      }),
    );
    message.textContent = '';
  } catch (error) {
    showError(error);
    message.textContent +=
      ' Retry below with the same request; we will not create a second booking.';
    bookButton.textContent = 'Retry this reservation';
    bookButton.disabled = false;
  }
});

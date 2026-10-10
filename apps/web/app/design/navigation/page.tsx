'use client';

import {
  Bell,
  CalendarDays,
  ChartColumn,
  CircleAlert,
  ClipboardList,
  Layers,
  Package,
  Percent,
  ShieldCheck,
  Tag,
  Upload,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../_ui/button';
import { Card } from '../_ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../_ui/select';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '../_ui/sheet';
import { PageHeader } from '../_ui/hotel';
import {
  Breadcrumb,
  MobileDrawerPanel,
  navByRole,
  NotificationTrigger,
  Pagination,
  SectionTabs,
  Sidebar,
  SidebarItem,
  TabBar,
  TopHeader,
  UserMenuTrigger,
  type NavRole,
  type TabEntry,
} from '../_ui/navigation';

const roles = Object.keys(navByRole) as NavRole[];

const inventoryTabs: TabEntry[] = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'payments', label: 'Payments', icon: Percent },
  { id: 'integrations', label: 'Integrations', icon: Layers },
  { id: 'archived', label: 'Archived', disabled: true },
];

const bookingTabs: TabEntry[] = [
  { id: 'attention', label: 'Needs attention', icon: CircleAlert },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'quick', label: 'Quick Booking', icon: CalendarDays },
  { id: 'health', label: 'System Health', icon: ChartColumn },
];

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function RolePicker({ value, onChange }: { value: NavRole; onChange: (role: NavRole) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as NavRole)}>
      <SelectTrigger aria-label="Role" className="w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {navByRole[role].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function NavigationDesignPage() {
  const [role, setRole] = useState<NavRole>('admin');
  const [current, setCurrent] = useState('dashboard');
  const [tab, setTab] = useState('overview');
  const [view, setView] = useState('attention');
  const [page, setPage] = useState(3);
  const items = navByRole[role].items;
  const activeId = items.some((item) => item.id === current) ? current : items[0]!.id;
  const activeLabel = items.find((item) => item.id === activeId)!.label;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="Navigation"
        description="Sidebar by role, mobile menu, top header, tabs, breadcrumb and pagination. Demo data only."
      />

      <Block
        title="Try it"
        note="A realistic app frame. Pick a role to see which destinations that role gets, and click around."
      >
        <div className="flex flex-wrap items-center gap-3">
          <RolePicker value={role} onChange={setRole} />
          <span className="text-sm text-muted-foreground">
            Desktop frame first, then the phone frame.
          </span>
        </div>
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex h-[640px] overflow-hidden rounded-xl border bg-background">
            <Sidebar role={role} current={activeId} onSelect={setCurrent} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopHeader
                title={activeLabel}
                actions={
                  <>
                    <Button
                      variant="outline"
                      className="hidden h-10 px-3 text-[13px] md:inline-flex [&_svg]:size-3.5"
                    >
                      <CalendarDays /> 12 – 18 Oct 2026
                    </Button>
                    <NotificationTrigger count={3} />
                    <UserMenuTrigger role={role} className="hidden md:flex" />
                  </>
                }
              />
              <div className="space-y-4 overflow-auto p-4 sm:p-6">
                <Breadcrumb items={['Home', 'Empire Beach Resort', activeLabel]} />
                <TabBar tabs={inventoryTabs} current={tab} onSelect={setTab} />
                <Card className="px-6 text-sm text-muted-foreground">
                  Page content begins here. Navigation never takes over the page: tabs switch views,
                  the sidebar switches areas.
                </Card>
                <Pagination page={page} pageCount={10} total={248} pageSize={25} onPage={setPage} />
              </div>
            </div>
          </div>

          <PhoneFrame
            role={role}
            current={activeId}
            title={activeLabel}
            onSelect={setCurrent}
            view={view}
            onView={setView}
          />
        </div>
      </Block>

      <Block
        title="Sidebar by role"
        note="Each role only sees the destinations it can use. Collapsed keeps icons and badges."
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {roles.map((r) => (
            <div key={r} className="space-y-2">
              <p className="text-sm font-semibold">{navByRole[r].label}</p>
              <div className="h-[600px] overflow-hidden rounded-xl border">
                <Sidebar role={r} current={navByRole[r].items[0]!.id} />
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <p className="text-sm font-semibold">Collapsed</p>
            <div className="h-[600px] overflow-hidden rounded-xl border">
              <Sidebar role="admin" collapsed />
            </div>
          </div>
        </div>
      </Block>

      <Block
        title="Mobile drawer"
        note="Same destinations as the sidebar, as a slide-over with a close button."
      >
        <div className="flex flex-wrap items-start gap-4">
          <p className="w-full text-sm text-muted-foreground">
            To open the real drawer, tap the menu button in the phone frame at the top of this page.
            It slides in from the right inside the phone, not over the whole screen.
          </p>
          {(['staff', 'finance'] as const).map((r) => (
            <div key={r} className="space-y-2">
              <p className="text-sm font-semibold">{navByRole[r].label}</p>
              <div className="h-[460px] overflow-hidden rounded-xl border">
                <MobileDrawerPanel role={r} current={navByRole[r].items[0]!.id} />
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block
        title="Top header"
        note="Page title on the left; date range, notifications and account on the right. Phones add a menu button."
      >
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <TopHeader
                className="rounded-xl border"
                title="Dashboard"
                actions={
                  <>
                    <Button variant="outline" className="h-10 px-3 text-[13px] [&_svg]:size-3.5">
                      <CalendarDays /> 12 – 18 Oct 2026
                    </Button>
                    <NotificationTrigger count={3} />
                    <UserMenuTrigger />
                  </>
                }
              />
            </div>
          </div>
          <TopHeader
            className="max-w-sm rounded-xl border"
            title="Dashboard"
            onMenu={() => undefined}
            actions={<NotificationTrigger count={12} />}
          />
        </div>
      </Block>

      <Block
        title="Tabs"
        note="Underline tabs switch views inside a page; segmented tabs are the quieter option. Both scroll sideways on small screens."
      >
        <div className="space-y-4">
          <TabBar tabs={inventoryTabs} current={tab} onSelect={setTab} />
          <SectionTabs tabs={bookingTabs} current={view} onSelect={setView} />
          <SectionTabs
            tabs={[
              { id: 'a', label: 'Rate plans', icon: Tag },
              { id: 'b', label: 'Data points', icon: Upload },
              { id: 'c', label: 'Taxes and fees', disabled: true },
            ]}
            current="a"
          />
        </div>
      </Block>

      <Block
        title="Parts"
        note="Sidebar item states, notification and account triggers, breadcrumb and pagination."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="gap-3 px-5">
            <p className="text-sm font-bold">Sidebar item</p>
            <SidebarItem item={navByRole.admin.items[0]!} />
            <SidebarItem item={navByRole.admin.items[1]!} current />
            <SidebarItem item={navByRole.admin.items[2]!} disabled />
            <SidebarItem item={navByRole.admin.items[1]!} collapsed current className="w-12" />
          </Card>
          <Card className="gap-4 px-5">
            <p className="text-sm font-bold">Triggers</p>
            <div className="flex items-center gap-3">
              <NotificationTrigger />
              <NotificationTrigger count={3} />
              <NotificationTrigger count={24} />
              <Button variant="outline" size="icon" aria-label="Notifications (muted)" disabled>
                <Bell />
              </Button>
            </div>
            <UserMenuTrigger />
            <UserMenuTrigger compact className="w-fit" />
          </Card>
          <Card className="gap-4 px-5 md:col-span-2">
            <p className="text-sm font-bold">Breadcrumb and pagination</p>
            <Breadcrumb items={['Bookings', 'MH-1042', 'Payment']} />
            <Pagination page={page} pageCount={10} total={248} pageSize={25} onPage={setPage} />
            <Pagination page={1} pageCount={4} total={92} pageSize={25} />
          </Card>
        </div>
      </Block>
    </div>
  );
}

/** Phone frame: menu button at the right of the header, scrollable bottom bar with every destination. */
function PhoneFrame({
  role,
  current,
  title,
  onSelect,
  view,
  onView,
}: {
  role: NavRole;
  current: string;
  title: string;
  onSelect: (id: string) => void;
  view: string;
  onView: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const items = navByRole[role].items;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div
        ref={setFrame}
        className="relative mx-auto flex h-[640px] w-[320px] flex-col overflow-hidden rounded-[28px] border-4 border-foreground/80 bg-background"
      >
        <TopHeader
          title={title}
          className="px-3"
          onMenu={() => setOpen(true)}
          actions={<NotificationTrigger count={3} />}
        />
        <div className="flex-1 space-y-3 overflow-auto p-3">
          <Breadcrumb items={['Home', 'Empire Beach Resort', title]} />
          <SectionTabs tabs={bookingTabs.slice(0, 3)} current={view} onSelect={onView} compact />
          <Card className="px-4 text-sm text-muted-foreground">
            Menu button sits at the right of the header. The bottom bar scrolls sideways.
          </Card>
        </div>
        <nav
          aria-label="Quick destinations"
          className="flex gap-1 overflow-x-auto border-t bg-card px-1 py-1.5"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={item.id === current ? 'page' : undefined}
              className={
                item.id === current
                  ? 'flex shrink-0 flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px] font-semibold text-primary'
                  : 'flex shrink-0 flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px] font-semibold text-muted-foreground'
              }
            >
              <item.icon className="size-4" />
              {item.label.split(' ')[0]}
            </button>
          ))}
        </nav>
      </div>
      <SheetContent side="right" hideClose container={frame} className="w-64 max-w-[85%] gap-0 p-0">
        <SheetTitle className="sr-only">Main menu</SheetTitle>
        <SheetClose asChild>
          <div className="h-full">
            <MobileDrawerPanel
              role={role}
              current={current}
              onSelect={onSelect}
              className="w-full"
            />
          </div>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

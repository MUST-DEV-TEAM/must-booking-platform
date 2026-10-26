'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { CopyButton } from '../../../../components/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';
import { FormField } from '../../../../components/ui/form-field';
import { IconButton } from '../../../../components/ui/icon-button';
import { Input } from '../../../../components/ui/input';
import { PageHeader } from '../../../../components/ui/page-header';
import { PasswordField } from '../../../../components/ui/password-field';
import { PermissionPanel } from '../../../../components/ui/permission-panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ErrorPanel } from '../../../../components/ui/state-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  ConsoleApiError,
  consoleGet,
  consolePatch,
  consolePost,
  type TeamMember,
  type TeamRole,
} from '../../../../lib/platform-api';
import { formatAgo } from '../../../../lib/platform-format';
import { useConsoleSession } from '../console-frame';

type RolesResponse = {
  roles: TeamRole[];
  catalog: Array<{ group: string; key: string; label: string; description: string }>;
};
const STATUS_TONE = { ACTIVE: 'success', INVITED: 'warning', SUSPENDED: 'danger' } as const;
const STATUS_LABEL = { ACTIVE: 'Active', INVITED: 'Invited', SUSPENDED: 'Suspended' } as const;

function AddMemberDialog({
  roles,
  open,
  onOpenChange,
  onDone,
}: {
  roles: TeamRole[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'invite' | 'create'>('invite');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? 'operations');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [invitationLink, setInvitationLink] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        roleKey,
      };
      if (mode === 'invite') {
        const result = await consolePost<{ invitationToken: string }>('/team/invitations', body);
        setInvitationLink(
          `${window.location.origin}/platform/accept-invitation?token=${encodeURIComponent(result.invitationToken)}`,
        );
      } else {
        await consolePost('/team', { ...body, password });
        onOpenChange(false);
      }
      onDone();
    },
  });

  const failure = save.error instanceof ConsoleApiError ? save.error : null;

  function submit() {
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email.';
    if (
      mode === 'create' &&
      (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    )
      next.password = 'At least 12 characters with a letter and a digit.';
    setProblems(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setInvitationLink(null);
          setEmail('');
          setPassword('');
          save.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            Platform accounts are separate from hotel accounts and use their own sign-in.
          </DialogDescription>
        </DialogHeader>
        {invitationLink ? (
          <Alert variant="success">
            <AlertTitle>Invitation created</AlertTitle>
            <AlertDescription>
              Send this link to {email}. It works once and expires in 7 days. It is shown only now.
              <span className="flex w-full items-center gap-1 break-all rounded-md border bg-card p-2 text-xs text-foreground">
                {invitationLink}
                <CopyButton value={invitationLink} label="Copy invitation link" />
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            {failure ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {failure.message}
                  {failure.reference ? ` Reference: ${failure.reference}` : ''}
                </AlertDescription>
              </Alert>
            ) : null}
            <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <TabsList>
                <TabsTrigger value="invite">Send invitation</TabsTrigger>
                <TabsTrigger value="create">Create with password</TabsTrigger>
              </TabsList>
              <TabsContent value="invite" className="pt-2 text-xs text-muted-foreground">
                They choose their own password from a one-time link.
              </TabsContent>
              <TabsContent value="create" className="pt-2 text-xs text-muted-foreground">
                You set the password and share it safely. They can sign in straight away.
              </TabsContent>
            </Tabs>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="First name" htmlFor="member-first">
                <Input
                  id="member-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </FormField>
              <FormField label="Last name" htmlFor="member-last">
                <Input
                  id="member-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Email" htmlFor="member-email" required error={problems.email}>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <FormField label="Role" required>
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.key} value={role.key}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {mode === 'create' ? (
              <FormField
                label="Password"
                htmlFor="member-password"
                required
                error={problems.password}
              >
                <PasswordField id="member-password" value={password} onChange={setPassword} />
              </FormField>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {invitationLink ? 'Done' : 'Cancel'}
          </Button>
          {!invitationLink ? (
            <Button onClick={submit} loading={save.isPending}>
              {mode === 'invite' ? 'Create invitation' : 'Create account'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleDialog({
  member,
  roles,
  onClose,
  onDone,
}: {
  member: TeamMember;
  roles: TeamRole[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [roleKey, setRoleKey] = useState(member.roleKey);
  const save = useMutation({
    mutationFn: () => consolePatch(`/team/${member.id}/role`, { roleKey, version: member.version }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const failure = save.error instanceof ConsoleApiError ? save.error : null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change role for {member.name ?? member.email}</DialogTitle>
          <DialogDescription>
            The new role applies the next time they use the console.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <Alert variant="destructive">
            <AlertDescription>{failure.message}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label="Role">
          <Select value={roleKey} onValueChange={setRoleKey}>
            <SelectTrigger aria-label="New role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.key} value={role.key}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={roleKey === member.roleKey}
          >
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const { me, can } = useConsoleSession();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<TeamMember | null>(null);
  const [toggling, setToggling] = useState<TeamMember | null>(null);

  const members = useQuery({
    queryKey: ['platform-console', 'team'],
    queryFn: () => consoleGet<{ members: TeamMember[] }>('/team'),
    enabled: can('platform.team.view'),
  });
  const roles = useQuery({
    queryKey: ['platform-console', 'team-roles'],
    queryFn: () => consoleGet<RolesResponse>('/team/roles'),
    enabled: can('platform.team.view'),
  });

  if (!can('platform.team.view')) return <PermissionPanel />;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['platform-console', 'team'] });
  const manage = can('platform.team.manage');

  return (
    <>
      <PageHeader
        title="Team"
        description="MUST Group staff who can use this console, and what each role allows."
        actions={
          manage ? (
            <Button onClick={() => setAdding(true)}>
              <UserPlus aria-hidden="true" /> Add team member
            </Button>
          ) : null
        }
      />

      <Card className="gap-0 py-0">
        {members.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading team">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : members.isError ? (
          <div className="p-4">
            <ErrorPanel
              title="We couldn’t load the team"
              reference={
                members.error instanceof ConsoleApiError
                  ? (members.error.reference ?? undefined)
                  : undefined
              }
              onRetry={() => void members.refetch()}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <span className="font-semibold">{member.name ?? member.email}</span>
                    {member.id === me.id ? (
                      <Badge variant="muted" className="ml-2">
                        You
                      </Badge>
                    ) : null}
                    {member.name ? (
                      <span className="block text-xs text-muted-foreground">{member.email}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{member.roleName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[member.status]}>
                      {STATUS_LABEL[member.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatAgo(member.lastLoginAt)}
                  </TableCell>
                  <TableCell>
                    {manage && member.id !== me.id ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Actions for ${member.email}`} variant="ghost">
                            <MoreHorizontal aria-hidden="true" />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {member.status !== 'INVITED' ? (
                            <DropdownMenuItem onSelect={() => setChanging(member)}>
                              Change role
                            </DropdownMenuItem>
                          ) : null}
                          {member.status !== 'INVITED' ? (
                            <DropdownMenuItem onSelect={() => setToggling(member)}>
                              {member.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {roles.data?.roles.map((role) => (
            <div key={role.key} className="space-y-1.5 rounded-lg border p-4">
              <p className="m-0 text-sm font-bold">{role.name}</p>
              <p className="m-0 text-xs text-muted-foreground">{role.description}</p>
              <div className="flex flex-wrap gap-1 pt-1">
                {role.capabilities.map((key) => (
                  <Badge key={key} variant="secondary" className="font-normal">
                    {roles.data.catalog.find((entry) => entry.key === key)?.label ?? key}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {roles.data ? (
        <AddMemberDialog
          roles={roles.data.roles}
          open={adding}
          onOpenChange={setAdding}
          onDone={refresh}
        />
      ) : null}
      {changing && roles.data ? (
        <ChangeRoleDialog
          member={changing}
          roles={roles.data.roles}
          onClose={() => setChanging(null)}
          onDone={refresh}
        />
      ) : null}
      {toggling ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setToggling(null)}
          title={`${toggling.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'} ${toggling.name ?? toggling.email}?`}
          description={
            toggling.status === 'SUSPENDED'
              ? 'They will be able to sign in to the console again.'
              : 'They are signed out everywhere immediately and cannot sign in until reactivated.'
          }
          confirmLabel={toggling.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
          cancelLabel="Cancel"
          destructive={toggling.status !== 'SUSPENDED'}
          onConfirm={async () => {
            await consolePatch(`/team/${toggling.id}/status`, {
              status: toggling.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
              version: toggling.version,
            });
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

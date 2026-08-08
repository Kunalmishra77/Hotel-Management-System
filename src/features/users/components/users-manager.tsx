"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MonitorSmartphone, MoreHorizontal, Plus, ShieldOff, UserCheck, UserCog } from "lucide-react";
import { toast } from "sonner";
import type { RoleName } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIstDateTime } from "@/lib/utils";
import { adminResetPassword, createUser, setUserActive, updateUserRoles } from "../actions";
import type { UserRow } from "../internal";
import { ORG_WIDE_ROLES, ROLE_LABELS, ROLE_ORDER } from "../roles";
import { UserSessionsSheet } from "./user-sessions-sheet";

type Prop = { id: string; name: string };

function RoleScope({
  role,
  setRole,
  selected,
  setSelected,
  properties,
}: {
  role: RoleName;
  setRole: (r: RoleName) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  properties: Prop[];
}) {
  const orgWide = ORG_WIDE_ROLES.has(role);
  return (
    <>
      <div className="space-y-1.5">
        <Label>Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as RoleName)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_ORDER.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Property access</Label>
        {orgWide ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Administrators have access to all properties.
          </p>
        ) : (
          <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
            {properties.length === 0 ? (
              <p className="text-sm text-muted-foreground">No properties yet.</p>
            ) : (
              properties.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(p.id)}
                    onCheckedChange={(c) =>
                      setSelected(c === true ? [...selected, p.id] : selected.filter((x) => x !== p.id))
                    }
                  />
                  {p.name}
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function UsersManager({ users, properties }: { users: UserRow[]; properties: Prop[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [confirmUser, setConfirmUser] = useState<UserRow | null>(null);
  const [sessionsUser, setSessionsUser] = useState<UserRow | null>(null);

  const refresh = () => router.refresh();

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus /> Add user
        </Button>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={<UserCog />}
          title="No users yet"
          description="Create the first staff account and assign its role and property access."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> Add user
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roleAssignments.map((a, i) => (
                        <Badge key={i} variant="secondary">
                          {ROLE_LABELS[a.role]}
                          <span className="ml-1 text-muted-foreground">
                            · {ORG_WIDE_ROLES.has(a.role) ? "all" : `${a.propertyIds.length} prop`}
                          </span>
                        </Badge>
                      ))}
                      {u.totpEnabled ? <Badge variant="brass">2FA</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "success" : "outline"}>
                      {u.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.lastLoginAt ? formatIstDateTime(u.lastLoginAt) : "Never"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditUser(u)}>
                          <UserCog /> Edit roles
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResetUser(u)}>
                          <KeyRound /> Reset password
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSessionsUser(u)}>
                          <MonitorSmartphone /> Active sessions
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className={u.isActive ? "text-destructive focus:text-destructive" : ""}
                          onSelect={() => setConfirmUser(u)}
                        >
                          {u.isActive ? <ShieldOff /> : <UserCheck />}
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {addOpen ? (
        <AddUserSheet
          properties={properties}
          pending={pending}
          onClose={() => setAddOpen(false)}
          onSubmit={(payload) =>
            start(async () => {
              const r = await createUser(payload);
              if (r.ok) {
                toast.success("User created", { description: payload.email });
                setAddOpen(false);
                refresh();
              } else {
                toast.error(r.error.message);
              }
            })
          }
        />
      ) : null}

      {editUser ? (
        <EditRolesSheet
          user={editUser}
          properties={properties}
          pending={pending}
          onClose={() => setEditUser(null)}
          onSubmit={(assignment) =>
            start(async () => {
              const r = await updateUserRoles({ userId: editUser.id, assignments: [assignment] });
              if (r.ok) {
                toast.success("Roles updated", { description: editUser.name });
                setEditUser(null);
                refresh();
              } else {
                toast.error(r.error.message);
              }
            })
          }
        />
      ) : null}

      {resetUser ? (
        <ResetPasswordDialog
          user={resetUser}
          pending={pending}
          onClose={() => setResetUser(null)}
          onSubmit={(password) =>
            start(async () => {
              const r = await adminResetPassword({ userId: resetUser.id, password });
              if (r.ok) {
                toast.success("Password reset", { description: `${resetUser.name} was signed out everywhere.` });
                setResetUser(null);
                refresh();
              } else {
                toast.error(r.error.message);
              }
            })
          }
        />
      ) : null}

      {sessionsUser ? (
        <UserSessionsSheet
          user={{ id: sessionsUser.id, name: sessionsUser.name }}
          onClose={() => setSessionsUser(null)}
          onChanged={refresh}
        />
      ) : null}

      {confirmUser ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmUser.isActive ? "Deactivate" : "Reactivate"} {confirmUser.name}?</DialogTitle>
              <DialogDescription>
                {confirmUser.isActive
                  ? "They will be signed out immediately and cannot sign in until reactivated."
                  : "They will be able to sign in again."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmUser(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmUser.isActive ? "destructive" : "default"}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await setUserActive({ userId: confirmUser.id, isActive: !confirmUser.isActive });
                    if (r.ok) {
                      toast.success(confirmUser.isActive ? "User deactivated" : "User reactivated");
                      setConfirmUser(null);
                      refresh();
                    } else {
                      toast.error(r.error.message);
                    }
                  })
                }
              >
                {confirmUser.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function AddUserSheet({
  properties,
  pending,
  onClose,
  onSubmit,
}: {
  properties: Prop[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: { email: string; name: string; password: string; role: RoleName; propertyIds: string[] }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleName>("RECEPTION");
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add user</SheetTitle>
          <SheetDescription>Create a staff account and assign its access.</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Nair" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Work email</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@woodpecker.example" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pass">Temporary password</Label>
            <PasswordInput id="u-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">At least 10 characters. The user can change it from Security.</p>
          </div>
          <RoleScope role={role} setRole={setRole} selected={selected} setSelected={setSelected} properties={properties} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => onSubmit({ email, name, password, role, propertyIds: selected })}
          >
            {pending ? "Creating…" : "Create user"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EditRolesSheet({
  user,
  properties,
  pending,
  onClose,
  onSubmit,
}: {
  user: UserRow;
  properties: Prop[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (a: { role: RoleName; propertyIds: string[] }) => void;
}) {
  const first = user.roleAssignments[0];
  const [role, setRole] = useState<RoleName>(first?.role ?? "RECEPTION");
  const [selected, setSelected] = useState<string[]>(first?.propertyIds ?? []);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit roles — {user.name}</SheetTitle>
          <SheetDescription>Changes take effect on their next request.</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          <RoleScope role={role} setRole={setRole} selected={selected} setSelected={setSelected} properties={properties} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSubmit({ role, propertyIds: selected })}>
            {pending ? "Saving…" : "Save roles"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ResetPasswordDialog({
  user,
  pending,
  onClose,
  onSubmit,
}: {
  user: UserRow;
  pending: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password — {user.name}</DialogTitle>
          <DialogDescription>Sets a new password and signs the user out of every device.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="r-pass">New password</Label>
          <PasswordInput id="r-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSubmit(password)}>
            {pending ? "Resetting…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

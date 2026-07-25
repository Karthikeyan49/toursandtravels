import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Pencil, Plus, Search, UserCheck, UserX } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  activateUser,
  createUser,
  deactivateUser,
  listUsers,
  resetUserPassword,
  updateUser,
  USER_TYPES,
  type CreateUserInput,
  type StaffUser,
  type UpdateUserInput,
  type UserFilters,
  type UserType,
} from "@/lib/api/users";
import { STAFF_ROLES, type StaffRole } from "@/lib/constants";
import { formatDateTime, formatPhone } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import {
  applyApiErrors,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
  type SelectOption,
} from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const USER_TYPE_LABELS: Record<UserType, string> = {
  staff: "Staff",
  agent: "Agent",
  customer: "Customer",
};

const roleOptions: SelectOption[] = STAFF_ROLES.map((role) => ({ value: role, label: humanize(role) }));
const userTypeOptions: SelectOption[] = USER_TYPES.map((type) => ({ value: type, label: USER_TYPE_LABELS[type] }));

/**
 * A generated password exists only inside this dialog: it is never written to
 * the query cache, never persisted and never logged. Closing the dialog drops
 * the only copy the browser holds.
 */
interface OneTimeCredential {
  full_name: string;
  password: string;
}

const userSchema = z
  .object({
    full_name: z.string().trim().min(1, "Name is required").max(150),
    user_type: z.enum(USER_TYPES),
    email: z.string().trim().email("Enter a valid email").max(190).optional().or(z.literal("")),
    phone: z.string().trim().max(20).optional(),
    staff_role: z.enum(STAFF_ROLES).optional(),
    agency_id: z.number().int().min(1, "Enter a valid agency id").optional(),
    password: z.string().min(8, "At least 8 characters").max(200).optional().or(z.literal("")),
    is_active: z.boolean().optional(),
  })
  .superRefine((values, ctx) => {
    // Login is by email or phone, so the API insists on at least one.
    if (!values.email && !values.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Provide an email address or a phone number",
      });
    }
    if (values.user_type === "staff" && !values.staff_role) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["staff_role"], message: "A staff user needs a role" });
    }
    if (values.user_type === "agent" && values.agency_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["agency_id"], message: "An agent user must belong to an agency" });
    }
  });
type UserFormValues = z.infer<typeof userSchema>;

const KNOWN_FIELDS = [
  "full_name",
  "user_type",
  "email",
  "phone",
  "staff_role",
  "agency_id",
  "password",
  "is_active",
] as const;

function UserDialog({
  user,
  open,
  onOpenChange,
  onCredential,
}: {
  user: StaffUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCredential: (credential: OneTimeCredential) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = user !== null;

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: user
      ? {
          full_name: user.full_name,
          user_type: user.user_type,
          email: user.email ?? "",
          phone: user.phone ?? undefined,
          staff_role: user.staff_role ?? undefined,
          agency_id: user.agency_id ?? undefined,
          is_active: user.is_active === 1,
        }
      : { user_type: "staff", email: "", is_active: true },
  });

  const userType = useWatch({ control, name: "user_type" });

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit) {
        const input: UpdateUserInput = {
          full_name: values.full_name,
          email: values.email || null,
          phone: values.phone || null,
          staff_role: user.user_type === "staff" ? values.staff_role : undefined,
          // Only the agent form exposes this — omitting it leaves the stored
          // link alone rather than clearing it.
          agency_id: user.user_type === "agent" ? values.agency_id ?? null : undefined,
          is_active: values.is_active ?? true,
        };
        await updateUser(user.id, input);
        toast.success("User updated");
      } else {
        const input: CreateUserInput = {
          full_name: values.full_name,
          user_type: values.user_type,
          email: values.email || null,
          phone: values.phone || null,
          staff_role: values.user_type === "staff" ? values.staff_role : undefined,
          agency_id: values.user_type === "agent" ? values.agency_id ?? null : null,
        };
        if (values.password) input.password = values.password;

        const result = await createUser(input);
        toast.success("User created");
        if (result.temporary_password) {
          onCredential({ full_name: result.user.full_name, password: result.temporary_password });
        }
      }
      await queryClient.invalidateQueries({ queryKey: qk.users.all });
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this user", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit user" : "New user"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Account details and access. Sign-in is by email or phone."
              : "Leave the password blank to have the API generate one — it is shown once, right after saving."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="full_name" label="Full name" required className="sm:col-span-2" />
          <SelectField
            control={control}
            name="user_type"
            label="User type"
            options={userTypeOptions}
            required
            disabled={isEdit}
            description={isEdit ? "The account type cannot be changed after creation." : undefined}
          />
          {(isEdit ? user.user_type : userType) === "staff" && (
            <SelectField control={control} name="staff_role" label="Role" options={roleOptions} required placeholder="Select role" />
          )}
          {(isEdit ? user.user_type : userType) === "agent" && (
            <NumberField control={control} name="agency_id" label="Agency id" min={1} step={1} required />
          )}
          <TextField control={control} name="email" label="Email" type="email" autoComplete="off" />
          <TextField control={control} name="phone" label="Phone" type="tel" autoComplete="off" />
          {!isEdit && (
            <TextField
              control={control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder="Leave blank to generate"
              description="A generated password forces a change at first sign-in."
              className="sm:col-span-2"
            />
          )}
          {isEdit && (
            <SwitchField
              control={control}
              name="is_active"
              label="Active"
              description="Deactivating revokes every live session immediately."
              className="sm:col-span-2"
            />
          )}

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {isEdit ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialDialog({
  credential,
  onDismiss,
}: {
  credential: OneTimeCredential | null;
  onDismiss: () => void;
}) {
  const copy = () => {
    if (!credential) return;
    void navigator.clipboard.writeText(credential.password).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Could not copy — select the password and copy it manually"),
    );
  };

  return (
    <Dialog open={credential !== null} onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Shown once and never stored in this browser. Share it with {credential?.full_name ?? "the user"} over a
            secure channel — they must change it at first sign-in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <code className="flex-1 select-all break-all font-mono text-sm">{credential?.password}</code>
          <Button type="button" variant="outline" size="icon-sm" onClick={copy} aria-label="Copy password">
            <Copy />
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={onDismiss}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [userType, setUserType] = useState<UserType | "">("");
  const [staffRole, setStaffRole] = useState<StaffRole | "">("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "">("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const [dialogTarget, setDialogTarget] = useState<StaffUser | null | "new">(null);
  const [statusTarget, setStatusTarget] = useState<StaffUser | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);

  const filters: UserFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      user_type: userType || undefined,
      staff_role: staffRole || undefined,
      is_active: activeFilter === "" ? undefined : activeFilter === "active",
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, userType, staffRole, activeFilter, sort],
  );

  const listQuery = useQuery({ queryKey: qk.users.list(filters), queryFn: () => listUsers(filters) });

  const columns: Column<StaffUser>[] = [
    {
      key: "full_name",
      header: "User",
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.email ?? "—"}</p>
        </div>
      ),
    },
    { key: "phone", header: "Phone", render: (row) => formatPhone(row.phone), hideOnMobile: true },
    { key: "user_type", header: "Type", render: (row) => USER_TYPE_LABELS[row.user_type], hideOnMobile: true },
    {
      key: "staff_role",
      header: "Role",
      render: (row) =>
        row.staff_role ? <StatusBadge status={row.staff_role} label={humanize(row.staff_role)} size="sm" /> : "—",
    },
    {
      key: "is_active",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.is_active === 1 ? "active" : "inactive"} />
          {row.must_change_pw === 1 && <span className="text-[11px] text-muted-foreground">Must change password</span>}
        </div>
      ),
    },
    {
      key: "last_login_at",
      header: "Last sign-in",
      sortable: true,
      render: (row) => formatDateTime(row.last_login_at),
      hideOnMobile: true,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); setDialogTarget(row); }}
            aria-label={`Edit ${row.full_name}`}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); setResetPassword(""); setResetTarget(row); }}
            aria-label={`Reset password for ${row.full_name}`}
          >
            <KeyRound />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); setStatusTarget(row); }}
            aria-label={row.is_active === 1 ? `Deactivate ${row.full_name}` : `Activate ${row.full_name}`}
          >
            {row.is_active === 1 ? <UserX className="text-destructive" /> : <UserCheck />}
          </Button>
        </div>
      ),
    },
  ];

  const hasFilters = search !== "" || userType !== "" || staffRole !== "" || activeFilter !== "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Staff, agent and customer accounts, their roles and sign-in status."
        actions={<Button onClick={() => setDialogTarget("new")}><Plus /> Add user</Button>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, email or phone…"
              className="pl-8"
            />
          </div>

          <Select value={userType || "__all__"} onValueChange={(v) => { setUserType(v === "__all__" ? "" : (v as UserType)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {USER_TYPES.map((t) => <SelectItem key={t} value={t}>{USER_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={staffRole || "__all__"} onValueChange={(v) => { setStaffRole(v === "__all__" ? "" : (v as StaffRole)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All roles</SelectItem>
              {STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select
            value={activeFilter || "__all__"}
            onValueChange={(v) => { setActiveFilter(v === "__all__" ? "" : (v as "active" | "inactive")); setPage(1); }}
          >
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(""); setUserType(""); setStaffRole(""); setActiveFilter(""); setPage(1); }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => setDialogTarget(row)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
        rowClassName={(row) => (row.is_active === 1 ? undefined : "opacity-60")}
        empty={<EmptyState title="No users" description="No account matches the current filters." />}
      />

      {dialogTarget !== null && (
        <UserDialog
          user={dialogTarget === "new" ? null : dialogTarget}
          open={dialogTarget !== null}
          onOpenChange={(open) => { if (!open) setDialogTarget(null); }}
          onCredential={setCredential}
        />
      )}

      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(open) => { if (!open) setStatusTarget(null); }}
        title={statusTarget?.is_active === 1 ? "Deactivate this account?" : "Reactivate this account?"}
        description={
          statusTarget
            ? statusTarget.is_active === 1
              ? `${statusTarget.full_name} will be signed out of every device immediately and will not be able to sign in again.`
              : `${statusTarget.full_name} will be able to sign in again with their existing password.`
            : undefined
        }
        confirmLabel={statusTarget?.is_active === 1 ? "Deactivate" : "Activate"}
        destructive={statusTarget?.is_active === 1}
        icon={statusTarget?.is_active === 1 ? UserX : UserCheck}
        onConfirm={async () => {
          if (!statusTarget) return;
          if (statusTarget.is_active === 1) {
            await deactivateUser(statusTarget.id);
            toast.success("Account deactivated");
          } else {
            await activateUser(statusTarget.id);
            toast.success("Account activated");
          }
          await queryClient.invalidateQueries({ queryKey: qk.users.all });
          setStatusTarget(null);
        }}
      />

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(""); } }}
        title="Reset this password?"
        description={
          resetTarget
            ? `${resetTarget.full_name} will be forced to choose a new password at their next sign-in.`
            : undefined
        }
        confirmLabel="Reset password"
        icon={KeyRound}
        onConfirm={async () => {
          if (!resetTarget) return;
          const typed = resetPassword.trim();
          const result = await resetUserPassword(resetTarget.id, typed === "" ? undefined : typed);
          setResetPassword("");
          setResetTarget(null);
          if (result.temporary_password) {
            setCredential({ full_name: result.user.full_name, password: result.temporary_password });
          } else {
            toast.success("Password reset");
          }
          await queryClient.invalidateQueries({ queryKey: qk.users.all });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="reset-password">New password</Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            placeholder="Leave blank to generate one"
          />
          <p className="text-xs text-muted-foreground">
            A generated password is displayed once, immediately after the reset.
          </p>
        </div>
      </ConfirmDialog>

      <CredentialDialog credential={credential} onDismiss={() => setCredential(null)} />
    </div>
  );
}

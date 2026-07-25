import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  getSettings,
  updateSettings,
  type CompanyProfile,
  type SettingRow,
  type SettingsUpdateInput,
} from "@/lib/api/settings";
import { formatDateTime } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, TextField, TextareaField } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Every field on this page is a row in the `settings` table, so the form field
 * names are the setting keys themselves — a 422 from the API then lands on the
 * right control without a translation table in the middle.
 *
 * The key space is closed server-side (AdminController::isWritable): anything
 * the API refuses comes back in `ignored`, which is surfaced rather than
 * silently dropped.
 */

/** Mirrors AdminController::WRITABLE_SETTING_PREFIXES. */
const WRITABLE_PREFIXES = ["company_", "bank_", "default_", "seq_"] as const;
/** Mirrors AdminController::WRITABLE_SETTINGS. */
const WRITABLE_KEYS = [
  "iata_number",
  "quote_validity_days",
  "advance_percent",
  "balance_due_days_before",
  "lead_idle_alert_hours",
  "passport_expiry_alert_days",
  "hold_expiry_hours",
] as const;

function isWritableKey(key: string): boolean {
  return (
    (WRITABLE_KEYS as readonly string[]).includes(key) ||
    WRITABLE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

const profileSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required").max(150),
  company_legal_name: z.string().trim().max(190).optional(),
  company_address: z.string().trim().max(400).optional(),
  company_city: z.string().trim().max(80).optional(),
  company_state: z.string().trim().max(80).optional(),
  company_pincode: z.string().trim().max(10).optional(),
  company_phone: z.string().trim().max(20).optional(),
  company_email: z.string().trim().email("Enter a valid email").max(190).optional().or(z.literal("")),
  company_website: z.string().trim().max(190).optional(),
  company_gstin: z.string().trim().max(15).optional(),
  company_pan: z.string().trim().max(10).optional(),
  company_logo: z.string().trim().max(5000).optional(),
  company_primary_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #0F766E")
    .optional()
    .or(z.literal("")),
  iata_number: z.string().trim().max(40).optional(),
  bank_name: z.string().trim().max(120).optional(),
  bank_account_name: z.string().trim().max(150).optional(),
  bank_account_no: z.string().trim().max(40).optional(),
  bank_ifsc: z.string().trim().max(15).optional(),
  bank_upi_id: z.string().trim().max(80).optional(),
});
type ProfileFormValues = z.infer<typeof profileSchema>;

const PROFILE_KEYS = [
  "company_name",
  "company_legal_name",
  "company_address",
  "company_city",
  "company_state",
  "company_pincode",
  "company_phone",
  "company_email",
  "company_website",
  "company_gstin",
  "company_pan",
  "company_logo",
  "company_primary_color",
  "iata_number",
  "bank_name",
  "bank_account_name",
  "bank_account_no",
  "bank_ifsc",
  "bank_upi_id",
] as const satisfies readonly (keyof ProfileFormValues)[];

function CompanyProfileForm({
  company,
  onIgnored,
}: {
  company: CompanyProfile;
  onIgnored: (ignored: string[]) => void;
}) {
  const queryClient = useQueryClient();

  const { control, handleSubmit, setError, formState: { isSubmitting } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      company_name: company.name,
      company_legal_name: company.legal_name,
      company_address: company.address,
      company_city: company.city,
      company_state: company.state,
      company_pincode: company.pincode,
      company_phone: company.phone,
      company_email: company.email,
      company_website: company.website,
      company_gstin: company.gstin,
      company_pan: company.pan,
      company_logo: company.logo,
      company_primary_color: company.primary_color,
      iata_number: company.iata_number,
      bank_name: company.bank.name,
      bank_account_name: company.bank.account_name,
      bank_account_no: company.bank.account_no,
      bank_ifsc: company.bank.ifsc,
      bank_upi_id: company.bank.upi_id,
    },
  });

  const logo = useWatch({ control, name: "company_logo" });
  const primaryColor = useWatch({ control, name: "company_primary_color" });

  const onSubmit = handleSubmit(async (values) => {
    const payload: SettingsUpdateInput = {};
    for (const key of PROFILE_KEYS) payload[key] = values[key] ?? "";

    try {
      const result = await updateSettings(payload);
      onIgnored(result.ignored);
      toast.success(
        result.updated.length === 0
          ? "No changes to save"
          : `${result.updated.length} setting${result.updated.length === 1 ? "" : "s"} saved`,
      );
      if (result.ignored.length > 0) {
        toast.warning(`${result.ignored.length} key(s) were rejected by the server`);
      }
      await queryClient.invalidateQueries({ queryKey: qk.settings.map });
    } catch (error) {
      if (!applyApiErrors(error, setError, PROFILE_KEYS)) {
        toast.fromError(error, "Could not save the company profile", true);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Company profile</CardTitle>
          <CardDescription>Printed on the letterhead of every invoice, cash bill, quotation and voucher.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="company_name" label="Trading name" required />
          <TextField control={control} name="company_legal_name" label="Registered legal name" />
          <TextareaField control={control} name="company_address" label="Address" rows={2} className="sm:col-span-2" />
          <TextField control={control} name="company_city" label="City" />
          <TextField
            control={control}
            name="company_state"
            label="State"
            description="Drives CGST/SGST vs IGST on every invoice."
          />
          <TextField control={control} name="company_pincode" label="PIN code" />
          <TextField control={control} name="company_phone" label="Phone" type="tel" />
          <TextField control={control} name="company_email" label="Email" type="email" />
          <TextField control={control} name="company_website" label="Website" type="url" />
          <TextField control={control} name="company_gstin" label="GSTIN" />
          <TextField control={control} name="company_pan" label="PAN" />
          <TextField control={control} name="iata_number" label="IATA / TAFI / IATO number" />

          <div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <TextField
                control={control}
                name="company_logo"
                label="Logo"
                placeholder="/uploads/logo.png or data:image/png;base64,…"
                description="Only a data: URL can be embedded in generated PDFs; a path renders in the app only."
              />
              {logo ? (
                <img src={logo} alt="Company logo preview" className="h-10 w-auto max-w-[12rem] object-contain" />
              ) : null}
            </div>

            <div className="space-y-1.5">
              <TextField
                control={control}
                name="company_primary_color"
                label="Brand colour"
                placeholder="#0F766E"
                description="Accent colour on documents, as a 6-digit hex value."
              />
              {primaryColor ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="h-5 w-5 rounded border"
                    style={{ backgroundColor: primaryColor }}
                    aria-hidden
                  />
                  {primaryColor}
                </span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bank details</CardTitle>
          <CardDescription>Printed in the payment block on invoices and cash bills.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="bank_name" label="Bank" />
          <TextField control={control} name="bank_account_name" label="Account holder" />
          <TextField control={control} name="bank_account_no" label="Account number" />
          <TextField control={control} name="bank_ifsc" label="IFSC" />
          <TextField control={control} name="bank_upi_id" label="UPI ID" className="sm:col-span-2" />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Save company profile
        </Button>
      </div>
    </form>
  );
}

function toEditableString(row: SettingRow): string {
  if (row.value === null || row.value === undefined) return "";
  if (typeof row.value === "boolean") return row.value ? "true" : "false";
  if (typeof row.value === "object") return JSON.stringify(row.value);
  return String(row.value);
}

function OperationalDefaultsForm({
  rows,
  onIgnored,
}: {
  rows: SettingRow[];
  onIgnored: (ignored: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.key, toEditableString(row)])),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const payload: SettingsUpdateInput = {};
    for (const row of rows) {
      const raw = values[row.key] ?? "";
      if (row.type === "bool") {
        payload[row.key] = raw === "true";
      } else if (row.type === "int" || row.type === "decimal") {
        // An empty numeric would be stored as "" and cast back to 0 — skip it.
        if (raw.trim() === "") continue;
        payload[row.key] = Number(raw);
      } else {
        payload[row.key] = raw;
      }
    }

    if (Object.keys(payload).length === 0) {
      toast.info("Nothing to save");
      return;
    }

    setSaving(true);
    try {
      const result = await updateSettings(payload);
      onIgnored(result.ignored);
      toast.success(
        result.updated.length === 0
          ? "No changes to save"
          : `${result.updated.length} setting${result.updated.length === 1 ? "" : "s"} saved`,
      );
      if (result.ignored.length > 0) {
        toast.warning(`${result.ignored.length} key(s) were rejected by the server`);
      }
      await queryClient.invalidateQueries({ queryKey: qk.settings.map });
    } catch (error) {
      toast.fromError(error, "Could not save these settings", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Operational defaults</CardTitle>
        <CardDescription>
          Pricing, quotation and alert defaults applied to new records. Existing documents keep the values they were
          created with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.map((row) => {
            const id = `setting-${row.key}`;
            const value = values[row.key] ?? "";

            return (
              <div key={row.key} className="space-y-1.5">
                <Label htmlFor={id}>{humanize(row.key)}</Label>
                {row.type === "bool" ? (
                  <div className="flex h-9 items-center">
                    <Switch
                      id={id}
                      checked={value === "true"}
                      onCheckedChange={(checked) =>
                        setValues((prev) => ({ ...prev, [row.key]: checked ? "true" : "false" }))
                      }
                    />
                  </div>
                ) : (
                  <Input
                    id={id}
                    type={row.type === "int" || row.type === "decimal" ? "number" : "text"}
                    inputMode={row.type === "decimal" ? "decimal" : undefined}
                    step={row.type === "decimal" ? "0.001" : row.type === "int" ? "1" : undefined}
                    min={row.type === "int" || row.type === "decimal" ? 0 : undefined}
                    value={value}
                    onChange={(e) => setValues((prev) => ({ ...prev, [row.key]: e.target.value }))}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {row.description ?? row.key}
                  {row.updated_at ? ` · updated ${formatDateTime(row.updated_at)}` : ""}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompanySettings() {
  const settingsQuery = useQuery({ queryKey: qk.settings.map, queryFn: getSettings });
  const [ignored, setIgnored] = useState<string[]>([]);

  const data = settingsQuery.data;
  const allRows = data?.settings ?? [];
  const managedByForm = new Set<string>(PROFILE_KEYS);

  // Numbering series (seq_*) are presented on the numbering screen; everything
  // else the settings table holds belongs to this page.
  const remaining = allRows.filter((row) => !managedByForm.has(row.key) && !row.key.startsWith("seq_"));
  const editableRows = remaining.filter((row) => isWritableKey(row.key) && row.type !== "json");
  const readOnlyRows = remaining.filter((row) => !isWritableKey(row.key) || row.type === "json");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Company settings"
        description="The letterhead, bank block and operational defaults every document is built from."
      />

      {ignored.length > 0 && (
        <Card className="border-status-overdue/50">
          <CardContent className="flex gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-overdue" aria-hidden />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Some keys were not saved</p>
              <p className="text-muted-foreground">
                The settings key space is closed on the server — a key that does not already exist, or that is not
                operator-writable, is ignored rather than created. Rejected:{" "}
                <span className="font-mono text-xs">{ignored.join(", ")}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {settingsQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {settingsQuery.isError && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Settings could not be loaded.{" "}
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => void settingsQuery.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <CompanyProfileForm key={`profile-${settingsQuery.dataUpdatedAt}`} company={data.company} onIgnored={setIgnored} />

          {editableRows.length > 0 && (
            <OperationalDefaultsForm
              key={`defaults-${settingsQuery.dataUpdatedAt}`}
              rows={editableRows}
              onIgnored={setIgnored}
            />
          )}

          {readOnlyRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Read-only settings</CardTitle>
                <CardDescription>Stored in the settings table but not operator-writable — changing these is a deploy.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {readOnlyRows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-4 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium">
                        <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                        {row.key}
                      </p>
                      {row.description && <p className="text-xs text-muted-foreground">{row.description}</p>}
                    </div>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{toEditableString(row) || "—"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

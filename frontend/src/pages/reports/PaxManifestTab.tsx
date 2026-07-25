import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, FileWarning, ShieldCheck, Users } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getPaxManifest, type PaxManifestRow } from "@/lib/api/reports";
import { listDepartures, type DepartureFilters } from "@/lib/api/packages";
import { formatDate, formatMoneyShort, formatNumber, formatPax, formatPhone } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportButton, FilterBar, type ExportParams } from "@/pages/reports/shared";

/**
 * The one report keyed by a single record rather than a date range, so it opens
 * with a departure picker. Passports and visas are the reason this list gets
 * printed at all — a passenger whose documents do not clear is flagged loudly.
 */

/** Enough batches for the picker without paging; the board itself lives on /departures. */
const DEPARTURE_PICKER_FILTERS: DepartureFilters = { limit: 200 };

export function PaxManifestTab({ active }: { active: boolean }) {
  const [departureId, setDepartureId] = useState("");

  const departuresQuery = useQuery({
    queryKey: qk.departures.list(DEPARTURE_PICKER_FILTERS),
    queryFn: () => listDepartures(DEPARTURE_PICKER_FILTERS),
    enabled: active,
  });

  const selectedId = departureId ? Number(departureId) : null;

  const manifestQuery = useQuery({
    queryKey: qk.reports.paxManifest(selectedId ?? 0),
    queryFn: () => getPaxManifest(selectedId ?? 0),
    enabled: active && selectedId !== null,
  });

  const exportParams: ExportParams = useMemo(
    () => ({ departure_id: selectedId ?? undefined }),
    [selectedId],
  );

  const manifest = manifestQuery.data;
  const departure = manifest?.departure;
  const summary = manifest?.summary;

  const mealPreferences = Object.entries(summary?.meal_preferences ?? {}).filter(([, count]) => count > 0);

  const columns: Column<PaxManifestRow>[] = [
    {
      key: "pax_no",
      header: "#",
      width: "3rem",
      align: "right",
      render: (row) => <span className="tabular text-muted-foreground">{row.pax_no}</span>,
    },
    {
      key: "full_name",
      header: "Passenger",
      render: (row) => (
        <div>
          <p className="font-medium">
            {row.title} {row.full_name}
            {row.is_lead_pax === 1 && (
              <Badge variant="secondary" className="ml-2 align-middle">
                Lead
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {humanize(row.pax_type)}
            {row.gender ? ` · ${humanize(row.gender)}` : ""}
            {row.age !== null ? ` · ${row.age}y` : ""}
            {row.nationality ? ` · ${row.nationality}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "booking_no",
      header: "Booking",
      render: (row) => (
        <div>
          <p>{row.booking_no}</p>
          <p className="text-xs text-muted-foreground">{row.customer_name ?? "—"}</p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "phone",
      header: "Contact",
      render: (row) => (
        <div>
          <p>{formatPhone(row.phone ?? row.booking_phone)}</p>
          {row.emergency_phone && (
            <p className="text-xs text-muted-foreground">
              ICE {row.emergency_contact ?? ""} {formatPhone(row.emergency_phone)}
            </p>
          )}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "passport_no",
      header: "Passport",
      render: (row) => (
        <div>
          <p className="tabular">{row.passport_no ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {row.passport_expiry ? `exp ${formatDate(row.passport_expiry)}` : "no expiry on file"}
            {row.passport_country ? ` · ${row.passport_country}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "visa_no",
      header: "Visa",
      render: (row) => (
        <div>
          <p className="tabular">{row.visa_no ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {row.visa_status ? humanize(row.visa_status) : "not recorded"}
            {row.visa_expiry ? ` · exp ${formatDate(row.visa_expiry)}` : ""}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "room_no",
      header: "Room / meal",
      render: (row) => (
        <div>
          <p>{row.room_no ?? row.room_type_label ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {humanize(row.meal_preference)}
            {row.occupancy ? ` · ${humanize(row.occupancy)}` : ""}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "document_ok",
      header: "Documents",
      render: (row) =>
        row.document_ok ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-status-paid">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Cleared
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-overdue">
            <FileWarning className="h-3.5 w-3.5" aria-hidden />
            Check documents
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <Select value={departureId} onValueChange={setDepartureId}>
          <SelectTrigger className="w-full min-w-[260px] sm:w-[420px]">
            <SelectValue placeholder={departuresQuery.isLoading ? "Loading departures…" : "Choose a departure"} />
          </SelectTrigger>
          <SelectContent>
            {(departuresQuery.data?.items ?? []).map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.batch_code} · {d.package_name} · {formatDate(d.departure_date)} ({d.seats_booked}/{d.seats_total})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <ExportButton slug="pax-manifest" params={exportParams} disabled={selectedId === null} />
        </div>
      </FilterBar>

      {selectedId === null ? (
        <EmptyState
          icon={CalendarRange}
          title="Pick a departure"
          description="The manifest lists every passenger booked onto a single fixed departure, with passport and visa status."
        />
      ) : manifestQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !manifest || !departure || !summary ? (
        <EmptyState title="No manifest available" description="This departure has no confirmed passengers yet." />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {departure.package_name}
                <StatusBadge status={departure.status} size="sm" />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Batch</p>
                <p className="font-medium">{departure.batch_code}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Travel</p>
                <p className="font-medium">
                  {formatDate(departure.departure_date)} – {formatDate(departure.return_date)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Route</p>
                <p className="font-medium">
                  {departure.departure_city ? `${departure.departure_city} → ` : ""}
                  {departure.destination_name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tour manager</p>
                <p className="font-medium">
                  {departure.tour_manager_name ?? "Not assigned"}
                  {departure.tour_manager_phone ? ` · ${formatPhone(departure.tour_manager_phone)}` : ""}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Passengers"
              value={formatNumber(summary.pax_count)}
              icon={Users}
              hint={formatPax(summary.adults, summary.children, summary.infants)}
            />
            <StatCard
              label="Seats free"
              value={formatNumber(summary.seats_free)}
              icon={CalendarRange}
              tone="info"
              hint={`of ${formatNumber(summary.seats_total)} · ${formatNumber(summary.booking_count)} booking(s)`}
            />
            <StatCard
              label="Document issues"
              value={formatNumber(summary.document_issues)}
              icon={AlertTriangle}
              tone={summary.document_issues > 0 ? "negative" : "positive"}
              hint="passport or visa needs attention"
            />
            <StatCard
              label="Outstanding"
              value={<MoneyText value={summary.outstanding} short />}
              icon={FileWarning}
              tone="warning"
              hint="balance still to collect"
            />
          </div>

          {mealPreferences.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Meal plan:</span>
              {mealPreferences.map(([preference, count]) => (
                <Badge key={preference} variant="secondary">
                  {humanize(preference)} · {count}
                </Badge>
              ))}
            </div>
          )}

          <DataTable
            columns={columns}
            rows={manifest.pax}
            rowKey={(row) => row.pax_id}
            ariaLabel={`Passenger manifest for ${departure.batch_code}`}
            stickyHeader
            empty={
              <EmptyState
                title="No passengers on this departure"
                description="Passengers appear here once a booking is attached to the batch."
              />
            }
            rowClassName={(row) => (row.document_ok ? undefined : "bg-status-overdue-bg/40")}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Bookings on this departure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {manifest.bookings.length === 0 ? (
                <EmptyState compact title="No bookings attached yet" />
              ) : (
                manifest.bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md px-2 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {booking.booking_no} · {booking.customer_name ?? "—"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatPax(booking.adults, booking.children, booking.infants)}
                        {booking.customer_phone ? ` · ${formatPhone(booking.customer_phone)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusBadge status={booking.payment_status} size="sm" />
                      <span className="text-xs text-muted-foreground">
                        {formatMoneyShort(booking.grand_total)} total
                      </span>
                      {Number(booking.outstanding) > 0 && (
                        <MoneyText value={booking.outstanding} short className="text-status-overdue text-xs" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

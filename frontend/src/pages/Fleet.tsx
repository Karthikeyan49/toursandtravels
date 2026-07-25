import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  listDrivers,
  listVehicles,
  VEHICLE_DOCUMENTS,
  type Driver,
  type DriverFilters,
  type Vehicle,
  type VehicleFilters,
} from "@/lib/api/fleet";
import { listDestinationOptions } from "@/lib/api/destinations";
import { formatDate } from "@/lib/format";
import { useDebounce } from "@/hooks/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Green when comfortably valid, amber inside 45 days, red once lapsed. */
function expiryTone(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days < 0) return "text-status-overdue font-medium";
  if (days <= 45) return "text-status-pending font-medium";
  return "text-muted-foreground";
}

function ExpiryCell({ date, days }: { date: string | null; days: number | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={expiryTone(days)}>
      {formatDate(date)}
      {days !== null && days < 0 && " (expired)"}
    </span>
  );
}

export default function Fleet() {
  const [tab, setTab] = useState<"vehicles" | "drivers">("vehicles");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [destinationId, setDestinationId] = useState("");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [vehiclePage, setVehiclePage] = useState(1);
  const [driverPage, setDriverPage] = useState(1);

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions });

  const vehicleFilters: VehicleFilters = useMemo(
    () => ({ page: vehiclePage, limit: 25, search: debouncedSearch || undefined, expiring: expiringOnly || undefined }),
    [vehiclePage, debouncedSearch, expiringOnly],
  );
  const driverFilters: DriverFilters = useMemo(
    () => ({ page: driverPage, limit: 25, search: debouncedSearch || undefined, destination_id: destinationId ? Number(destinationId) : undefined }),
    [driverPage, debouncedSearch, destinationId],
  );

  const vehiclesQuery = useQuery({
    queryKey: qk.fleet.vehicles(vehicleFilters),
    queryFn: () => listVehicles(vehicleFilters),
    enabled: tab === "vehicles",
  });
  const driversQuery = useQuery({
    queryKey: qk.fleet.drivers(driverFilters),
    queryFn: () => listDrivers(driverFilters),
    enabled: tab === "drivers",
  });

  const vehicleColumns: Column<Vehicle>[] = [
    {
      key: "registration_no",
      header: "Vehicle",
      render: (row) => (
        <div>
          <p className="font-medium">{row.registration_no}</p>
          <p className="text-xs text-muted-foreground">{row.vehicle_type_name}{row.model_year ? ` · ${row.model_year}` : ""}</p>
        </div>
      ),
    },
    { key: "seat_count", header: "Seats", align: "right", hideOnMobile: true },
    { key: "supplier_name", header: "Owner", render: (row) => row.is_owned ? "Own fleet" : (row.supplier_name ?? "—") },
    { key: "destination_name", header: "Base", render: (row) => row.destination_name ?? "—", hideOnMobile: true },
    ...VEHICLE_DOCUMENTS.map((doc) => ({
      key: doc.key as string,
      header: doc.label,
      hideOnMobile: true,
      render: (row: Vehicle) => (
        <ExpiryCell
          date={row[doc.key] as string | null}
          days={row[doc.key] ? Math.round(((new Date(row[doc.key] as string).getTime()) - Date.now()) / 86_400_000) : null}
        />
      ),
    })),
    {
      key: "days_to_next_expiry",
      header: "Compliance",
      render: (row) =>
        row.days_to_next_expiry >= 9999 ? (
          <StatusBadge status="active" label="No documents on file" />
        ) : row.days_to_next_expiry < 0 ? (
          <StatusBadge status="cancelled" label="Expired" />
        ) : row.days_to_next_expiry <= 45 ? (
          <StatusBadge status="pending" label={`${row.days_to_next_expiry}d left`} />
        ) : (
          <StatusBadge status="active" label="OK" />
        ),
    },
  ];

  const driverColumns: Column<Driver>[] = [
    {
      key: "full_name",
      header: "Driver",
      render: (row) => (
        <div>
          <p className="font-medium">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.phone}</p>
        </div>
      ),
    },
    { key: "licence_no", header: "Licence No", hideOnMobile: true },
    {
      key: "licence_expiry",
      header: "Licence expiry",
      render: (row) => <ExpiryCell date={row.licence_expiry} days={row.licence_days_left} />,
    },
    { key: "languages", header: "Languages", render: (row) => row.languages ?? "—", hideOnMobile: true },
    { key: "supplier_name", header: "Owner", render: (row) => row.supplier_name ?? "Own fleet" },
    { key: "destination_name", header: "Base", render: (row) => row.destination_name ?? "—", hideOnMobile: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Fleet" description="Owned and supplier vehicles, drivers, and their compliance paperwork." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "vehicles" | "drivers")}>
        <TabsList>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
        </TabsList>

        <Card className="mt-4">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVehiclePage(1); setDriverPage(1); }}
                placeholder={tab === "vehicles" ? "Search registration no…" : "Search name or phone…"}
                className="pl-8"
              />
            </div>
            {tab === "vehicles" ? (
              <Button
                type="button"
                variant={expiringOnly ? "default" : "outline"}
                size="sm"
                onClick={() => { setExpiringOnly((v) => !v); setVehiclePage(1); }}
              >
                <AlertTriangle /> Expiring within 45 days
              </Button>
            ) : (
              <Select value={destinationId || "__all__"} onValueChange={(v) => { setDestinationId(v === "__all__" ? "" : v); setDriverPage(1); }}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Base" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All bases</SelectItem>
                  {(destinationsQuery.data ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        <TabsContent value="vehicles" className="mt-4">
          <DataTable
            columns={vehicleColumns}
            rows={vehiclesQuery.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={vehiclesQuery.isLoading}
            pagination={vehiclesQuery.data?.pagination}
            onPageChange={setVehiclePage}
          />
        </TabsContent>
        <TabsContent value="drivers" className="mt-4">
          <DataTable
            columns={driverColumns}
            rows={driversQuery.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={driversQuery.isLoading}
            pagination={driversQuery.data?.pagination}
            onPageChange={setDriverPage}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

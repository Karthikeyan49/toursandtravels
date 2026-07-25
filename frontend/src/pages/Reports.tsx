import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, CalendarRange, Megaphone, TrendingUp, Truck, Users, Wallet } from "lucide-react";
import { formatDateRange } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { defaultReportRange } from "@/pages/reports/shared";
import { SalesReportTab } from "@/pages/reports/SalesReportTab";
import { MarginReportTab } from "@/pages/reports/MarginReportTab";
import { SupplierPerformanceTab } from "@/pages/reports/SupplierPerformanceTab";
import { PaxManifestTab } from "@/pages/reports/PaxManifestTab";
import { OutstandingTab } from "@/pages/reports/OutstandingTab";
import { LeadSourceRoiTab } from "@/pages/reports/LeadSourceRoiTab";

/**
 * The reporting hub. Six reports share one route and one date range; the active
 * one is mirrored into `?tab=` so a link to "the margin report we were looking
 * at" survives a paste into chat. Deliberately no separate routes — the reports
 * are variations on a theme, not destinations of their own.
 *
 * Only the visible report fetches. Two of the six ignore the shared range
 * entirely: the manifest is keyed by a departure, and outstanding money is a
 * position as of today rather than a period.
 */

const TABS = [
  { value: "sales", label: "Sales", icon: BarChart3, ranged: true },
  { value: "margin", label: "Margin", icon: TrendingUp, ranged: true },
  { value: "suppliers", label: "Suppliers", icon: Truck, ranged: true },
  { value: "manifest", label: "Pax manifest", icon: Users, ranged: false },
  { value: "outstanding", label: "Outstanding", icon: Wallet, ranged: false },
  { value: "lead-roi", label: "Lead source ROI", icon: Megaphone, ranged: true },
] as const;

type ReportTab = (typeof TABS)[number]["value"];

const DEFAULT_TAB: ReportTab = "sales";

function isReportTab(value: string | null): value is ReportTab {
  return value !== null && TABS.some((tab) => tab.value === value);
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: ReportTab = isReportTab(tabParam) ? tabParam : DEFAULT_TAB;

  const [range, setRange] = useState(defaultReportRange);
  const { from, to } = range;

  const rangeApplies = TABS.find((tab) => tab.value === activeTab)?.ranged === true;

  function selectTab(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === DEFAULT_TAB) next.delete("tab");
    else next.set("tab", value);
    setSearchParams(next, { replace: true });
  }

  function resetRange() {
    setRange(defaultReportRange());
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description={
          rangeApplies
            ? `Sales, margin and marketing performance for ${formatDateRange(from, to)}.`
            : "Operational reports keyed to a departure or to today's position."
        }
      />

      <Tabs value={activeTab} onValueChange={selectTab}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="h-auto flex-wrap justify-start">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {rangeApplies && (
            <Card className="shrink-0">
              <CardContent className="flex flex-wrap items-center gap-2 p-2">
                <CalendarRange className="ml-1 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className="w-36"
                  aria-label="Report period from"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className="w-36"
                  aria-label="Report period to"
                />
                <Button type="button" variant="ghost" size="sm" onClick={resetRange}>
                  Last 3 months
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <TabsContent value="sales">
          <SalesReportTab active={activeTab === "sales"} from={from} to={to} />
        </TabsContent>
        <TabsContent value="margin">
          <MarginReportTab active={activeTab === "margin"} from={from} to={to} />
        </TabsContent>
        <TabsContent value="suppliers">
          <SupplierPerformanceTab active={activeTab === "suppliers"} from={from} to={to} />
        </TabsContent>
        <TabsContent value="manifest">
          <PaxManifestTab active={activeTab === "manifest"} />
        </TabsContent>
        <TabsContent value="outstanding">
          <OutstandingTab active={activeTab === "outstanding"} />
        </TabsContent>
        <TabsContent value="lead-roi">
          <LeadSourceRoiTab active={activeTab === "lead-roi"} from={from} to={to} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

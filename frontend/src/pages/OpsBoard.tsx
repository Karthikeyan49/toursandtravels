import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Car, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { DAYSHEET_STATUSES, flagDaysheetIssue, getOpsBoard, toggleDaysheetChecklist, type DaysheetStatus } from "@/lib/api/ops";
import { formatDate, toISODate } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d) ?? date;
}

export default function OpsBoard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(() => toISODate(new Date()) ?? "");
  const [status, setStatus] = useState<DaysheetStatus | "">("");
  const [issueTarget, setIssueTarget] = useState<number | null>(null);
  const [issueNote, setIssueNote] = useState("");

  const filters = useMemo(() => ({ date, status: status || undefined }), [date, status]);
  const boardQuery = useQuery({ queryKey: qk.ops.board(date, filters), queryFn: () => getOpsBoard(filters) });
  const board = boardQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ops", "board"] });

  const toggleMutation = useMutation({
    mutationFn: ({ daysheetId, index, done }: { daysheetId: number; index: number; done: boolean }) =>
      toggleDaysheetChecklist(daysheetId, index, done),
    onSuccess: invalidate,
    onError: (error) => toast.fromError(error, "Could not update the checklist", true),
  });

  const issueMutation = useMutation({
    mutationFn: () => flagDaysheetIssue(issueTarget as number, issueNote.trim()),
    onSuccess: async () => {
      toast.success("Issue flagged — operations notified");
      await invalidate();
      setIssueTarget(null);
      setIssueNote("");
    },
    onError: (error) => toast.fromError(error, "Could not flag this issue", true),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operations board"
        description="Every booking on the road today: checklist, transport and any issues."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
              <ChevronLeft />
            </Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button variant="outline" size="icon-sm" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
              <ChevronRight />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDate(toISODate(new Date()) ?? "")}>Today</Button>
          </div>
        }
      />

      {board && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="On the road" value={String(board.summary.bookings_on_road)} icon={Car} />
          <StatCard label="Pax" value={String(board.summary.pax_on_road)} />
          <StatCard label="Ready / Done" value={String((board.summary.by_status.ready ?? 0) + (board.summary.by_status.done ?? 0))} tone="positive" icon={CheckCircle2} />
          <StatCard label="In progress" value={String(board.summary.by_status.in_progress ?? 0)} tone="info" />
          <StatCard label="Issues" value={String(board.summary.by_status.issue ?? 0)} tone={board.summary.by_status.issue > 0 ? "negative" : "default"} icon={AlertTriangle} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status || "__all__"} onValueChange={(v) => setStatus(v === "__all__" ? "" : (v as DaysheetStatus))}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Filter status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            {DAYSHEET_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {boardQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !board || board.daysheets.length === 0 ? (
        <EmptyState title="Nothing on the road" description="No bookings are travelling on this date." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {board.daysheets.map((sheet) => (
            <Card key={sheet.id} className={sheet.status === "issue" ? "border-status-overdue" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle
                      className="cursor-pointer text-base hover:underline"
                      onClick={() => navigate(`/bookings/${sheet.booking_id}`)}
                    >
                      {sheet.booking_no}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {sheet.customer_name ?? sheet.lead_pax_name} · Day {sheet.day_no}
                    </p>
                  </div>
                  <StatusBadge status={sheet.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {[sheet.city_name, sheet.hotel_name, sheet.destination_name].filter(Boolean).join(" · ") || "—"}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <Car className={sheet.transport_assigned > 0 ? "h-3.5 w-3.5 text-status-paid" : "h-3.5 w-3.5 text-status-overdue"} aria-hidden />
                  {sheet.transport_assigned > 0 ? "Transport assigned" : "Transport not assigned"}
                </div>

                <ul className="space-y-1.5">
                  {sheet.checklist.map((item, index) => (
                    <li key={`${sheet.id}-${index}`} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={item.done}
                        onCheckedChange={(checked) => toggleMutation.mutate({ daysheetId: sheet.id, index, done: checked === true })}
                        disabled={toggleMutation.isPending}
                      />
                      <span className={item.done ? "text-muted-foreground line-through" : undefined}>{item.label}</span>
                    </li>
                  ))}
                </ul>

                {sheet.issue_note && (
                  <p className="rounded-md bg-status-overdue-bg p-2 text-xs text-status-overdue">{sheet.issue_note}</p>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setIssueTarget(sheet.id); setIssueNote(""); }}
                >
                  <AlertTriangle /> Raise issue
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {board && board.transport.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Transport today</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {board.transport.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{t.booking_no}</p>
                  <p className="text-xs text-muted-foreground">{t.registration_no ?? "Vehicle TBD"} · {t.driver_name ?? "Driver TBD"}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t.pickup_time && <span>{t.pickup_time}</span>}
                  <StatusBadge status={t.status} size="sm" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={issueTarget !== null} onOpenChange={(open) => { if (!open) setIssueTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise an issue</DialogTitle>
            <DialogDescription>This notifies the operations owner immediately.</DialogDescription>
          </DialogHeader>
          <Textarea value={issueNote} onChange={(e) => setIssueNote(e.target.value)} rows={4} placeholder="What went wrong?" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={issueNote.trim() === "" || issueMutation.isPending}
              onClick={() => issueMutation.mutate()}
            >
              Flag issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { lazy, Suspense, useState, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Loader2 } from "lucide-react";
import { createQueryClient, type Permission } from "@/lib/api/client";
import { STORAGE_KEYS } from "@/lib/constants";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/DashboardLayout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// --- Eager: the pages almost every session opens ---------------------------
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Quotations from "@/pages/Quotations";
import Bookings from "@/pages/Bookings";
import Customers from "@/pages/Customers";
import NotFound from "@/pages/NotFound";

// --- Lazy: detail views, back-office and anything pulling charts/PDF/XLSX ---
const LeadDetail = lazy(() => import("@/pages/LeadDetail"));
const QuotationDetail = lazy(() => import("@/pages/QuotationDetail"));
const BookingDetail = lazy(() => import("@/pages/BookingDetail"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));

const Packages = lazy(() => import("@/pages/Packages"));
const PackageDetail = lazy(() => import("@/pages/PackageDetail"));
const Departures = lazy(() => import("@/pages/Departures"));
const Destinations = lazy(() => import("@/pages/Destinations"));
const Activities = lazy(() => import("@/pages/Activities"));

const Suppliers = lazy(() => import("@/pages/Suppliers"));
const SupplierDetail = lazy(() => import("@/pages/SupplierDetail"));
const Hotels = lazy(() => import("@/pages/Hotels"));
const Fleet = lazy(() => import("@/pages/Fleet"));

const OpsBoard = lazy(() => import("@/pages/OpsBoard"));
const TripAssignments = lazy(() => import("@/pages/TripAssignments"));
const Vouchers = lazy(() => import("@/pages/Vouchers"));
const Incidents = lazy(() => import("@/pages/Incidents"));

const Invoices = lazy(() => import("@/pages/Invoices"));
const InvoiceDetail = lazy(() => import("@/pages/InvoiceDetail"));
const Payments = lazy(() => import("@/pages/Payments"));
const SupplierBills = lazy(() => import("@/pages/SupplierBills"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Receivables = lazy(() => import("@/pages/Receivables"));
const Payables = lazy(() => import("@/pages/Payables"));
const ProfitLoss = lazy(() => import("@/pages/ProfitLoss"));
const Reports = lazy(() => import("@/pages/Reports"));

const Users = lazy(() => import("@/pages/Users"));
const CompanySettings = lazy(() => import("@/pages/CompanySettings"));
const NumberingSettings = lazy(() => import("@/pages/NumberingSettings"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading page" />
    </div>
  );
}

/** Route-level permission gate — keeps the JSX below readable. */
function Guarded({ permission, children }: { permission: Permission; children: ReactNode }) {
  return <ProtectedRoute permission={permission}>{children}</ProtectedRoute>;
}

export default function App() {
  // Built once per mount so tests get an isolated cache and HMR does not leak
  // a stale client between reloads.
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={STORAGE_KEYS.theme}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <Toaster />
          <BrowserRouter>
            {/* AuthProvider sits inside the router: it navigates to /login on
                the tt:auth-expired event. */}
            <AuthProvider>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/login" element={<Login />} />

                  <Route
                    element={
                      <ProtectedRoute>
                        <DashboardLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/" element={<Dashboard />} />

                    {/* Sales */}
                    <Route path="/leads" element={<Leads />} />
                    <Route path="/leads/:id" element={<LeadDetail />} />
                    <Route path="/quotations" element={<Quotations />} />
                    <Route path="/quotations/:id" element={<QuotationDetail />} />
                    <Route path="/bookings" element={<Bookings />} />
                    <Route path="/bookings/:id" element={<BookingDetail />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/customers/:id" element={<CustomerDetail />} />

                    {/* Products */}
                    <Route path="/packages" element={<Packages />} />
                    <Route path="/packages/:id" element={<PackageDetail />} />
                    <Route path="/departures" element={<Departures />} />
                    <Route path="/destinations" element={<Destinations />} />
                    <Route path="/activities" element={<Activities />} />

                    {/* Suppliers */}
                    <Route path="/suppliers" element={<Suppliers />} />
                    <Route path="/suppliers/:id" element={<SupplierDetail />} />
                    <Route path="/hotels" element={<Hotels />} />
                    <Route path="/fleet" element={<Fleet />} />

                    {/* Operations */}
                    <Route path="/ops" element={<OpsBoard />} />
                    <Route path="/trip-assignments" element={<TripAssignments />} />
                    <Route path="/vouchers" element={<Vouchers />} />
                    <Route path="/incidents" element={<Incidents />} />

                    {/* Finance */}
                    <Route path="/invoices" element={<Invoices />} />
                    <Route path="/invoices/:id" element={<InvoiceDetail />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route
                      path="/supplier-bills"
                      element={
                        <Guarded permission="view_costs">
                          <SupplierBills />
                        </Guarded>
                      }
                    />
                    <Route
                      path="/expenses"
                      element={
                        <Guarded permission="view_costs">
                          <Expenses />
                        </Guarded>
                      }
                    />
                    <Route path="/receivables" element={<Receivables />} />
                    <Route
                      path="/payables"
                      element={
                        <Guarded permission="view_costs">
                          <Payables />
                        </Guarded>
                      }
                    />
                    <Route
                      path="/profit-loss"
                      element={
                        <Guarded permission="view_margins">
                          <ProfitLoss />
                        </Guarded>
                      }
                    />

                    <Route path="/reports" element={<Reports />} />

                    {/* Settings */}
                    <Route
                      path="/settings/users"
                      element={
                        <Guarded permission="manage_users">
                          <Users />
                        </Guarded>
                      }
                    />
                    <Route
                      path="/settings/company"
                      element={
                        <Guarded permission="manage_settings">
                          <CompanySettings />
                        </Guarded>
                      }
                    />
                    <Route
                      path="/settings/numbering"
                      element={
                        <Guarded permission="manage_settings">
                          <NumberingSettings />
                        </Guarded>
                      }
                    />
                    <Route
                      path="/settings/audit"
                      element={
                        <Guarded permission="manage_settings">
                          <AuditLog />
                        </Guarded>
                      }
                    />

                    {/* Inside the shell so a signed-in user keeps their nav;
                        signed-out users are bounced to /login by the guard. */}
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </Suspense>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

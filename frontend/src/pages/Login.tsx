import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isApiError } from "@/lib/api/client";
import { APP_NAME } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, FormField, TextField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or phone number"),
  password: z.string().min(1, "Enter your password"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/** Non-form field names the server may still complain about via 422. */
const KNOWN_FIELDS = ["identifier", "password"] as const;

export default function Login() {
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  // A session already validated at boot skips the form entirely.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    const state = location.state as { reason?: string } | null;
    if (state?.reason === "expired") {
      toast.info("Your session expired. Please sign in again.");
    }
  }, [location.state]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await login(values.identifier, values.password);
      navigate("/", { replace: true });
    } catch (error) {
      const handled = applyApiErrors(error, setError, KNOWN_FIELDS);
      if (!handled) {
        const message = isApiError(error) ? error.message : "Could not sign in. Please try again.";
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  });

  const rootError = errors.root?.serverError?.message as string | undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LogIn className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">{APP_NAME}</CardTitle>
          <CardDescription>Sign in to manage enquiries, quotations and bookings</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <TextField
              control={control}
              name="identifier"
              label="Email or phone"
              placeholder="you@agency.com or 98765 43210"
              autoComplete="username"
              required
            />

            <FormField control={control} name="password" label="Password" required>
              {(field, { id, invalid, describedBy }) => (
                <Input
                  {...field}
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={typeof field.value === "string" ? field.value : ""}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                />
              )}
            </FormField>

            {rootError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {rootError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

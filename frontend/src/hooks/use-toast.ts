import { toast as sonnerToast } from "sonner";
import { type ApiError, isApiError } from "@/lib/api/client";

/**
 * Single entry point for notifications. Sonner owns the rendering; this exists
 * so pages never import the toast library directly and so every API failure is
 * surfaced the same way.
 */

export interface ToastOptions {
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

function success(message: string, options?: ToastOptions): void {
  sonnerToast.success(message, options);
}

function error(message: string, options?: ToastOptions): void {
  sonnerToast.error(message, { duration: 6000, ...options });
}

function info(message: string, options?: ToastOptions): void {
  sonnerToast(message, options);
}

function warning(message: string, options?: ToastOptions): void {
  sonnerToast.warning(message, options);
}

/**
 * Turns any thrown value into a readable toast.
 *
 * 422s are deliberately quiet by default: FormField renders those messages
 * inline against the offending control, and a toast on top of that is noise.
 * Pass `includeValidation` for flows with no form to attach them to.
 */
function fromError(cause: unknown, fallback = "Something went wrong", includeValidation = false): void {
  if (isApiError(cause)) {
    if (cause.isValidation && !includeValidation) return;

    const fields = Object.values(cause.errors).flat();
    error(cause.message || fallback, {
      description: fields.length > 0 ? fields.slice(0, 3).join(" · ") : undefined,
    });
    return;
  }

  if (cause instanceof Error) {
    error(cause.message || fallback);
    return;
  }

  error(fallback);
}

/** Wraps a promise with loading/success/error toasts (saves, exports, imports). */
function promise<T>(
  work: Promise<T>,
  messages: { loading: string; success: string | ((value: T) => string); error?: string },
): Promise<T> {
  sonnerToast.promise(work, {
    loading: messages.loading,
    success: messages.success,
    error: (cause: unknown) =>
      isApiError(cause) || cause instanceof Error ? cause.message : (messages.error ?? "Failed"),
  });
  return work;
}

export const toast = {
  success,
  error,
  info,
  warning,
  fromError,
  promise,
  dismiss: sonnerToast.dismiss,
};

/** Hook form, for parity with the rest of the hooks folder. */
export function useToast() {
  return { toast };
}

export type { ApiError };

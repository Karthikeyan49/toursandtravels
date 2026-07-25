import { useId, type ReactNode } from "react";
import { CalendarIcon } from "lucide-react";
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { isApiError } from "@/lib/api/client";
import { formatDate, toDate, toISODate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * react-hook-form field plumbing in one place: label, control, description and
 * the error message, with ids and aria wiring done for you. Pages never
 * hand-roll validation — they define a zod schema and render these.
 */

interface RenderArgs {
  /** Put this on the control so the label's htmlFor resolves. */
  id: string;
  invalid: boolean;
  /** Space-separated ids of the description and error nodes. */
  describedBy: string | undefined;
}

export interface FormFieldProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> {
  control: Control<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  required?: boolean;
  className?: string;
  /** Renders the control. Receives RHF's field plus the accessibility ids. */
  children: (field: ControllerRenderProps<TFieldValues, TName>, args: RenderArgs) => ReactNode;
}

export function FormField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  label,
  description,
  required = false,
  className,
  children,
}: FormFieldProps<TFieldValues, TName>) {
  const reactId = useId();
  const id = `${reactId}-${name}`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message;
        const invalid = message !== undefined;
        const describedBy =
          [description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;

        return (
          <div className={cn("space-y-1.5", className)}>
            {label && (
              <Label htmlFor={id} className={cn(invalid && "text-destructive")}>
                {label}
                {required && (
                  <span className="ml-0.5 text-destructive" aria-hidden>
                    *
                  </span>
                )}
              </Label>
            )}

            {children(field, { id, invalid, describedBy })}

            {description && !invalid && (
              <p id={descriptionId} className="text-xs text-muted-foreground">
                {description}
              </p>
            )}

            {invalid && (
              <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
                {message}
              </p>
            )}
          </div>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Bound controls
// ---------------------------------------------------------------------------

interface BoundProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> {
  control: Control<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function TextField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  placeholder,
  type = "text",
  autoComplete,
  disabled,
  ...props
}: BoundProps<TFieldValues, TName> & {
  placeholder?: string;
  type?: "text" | "email" | "tel" | "password" | "url";
  autoComplete?: string;
}) {
  return (
    <FormField {...props}>
      {(field, { id, invalid, describedBy }) => {
        // RHF's value type is an unresolved generic here; widening through
        // `unknown` keeps this honest without an `any`.
        const raw: unknown = field.value;
        return (
          <Input
            {...field}
            id={id}
            type={type}
            placeholder={placeholder}
            autoComplete={autoComplete}
            disabled={disabled}
            value={raw === null || raw === undefined ? "" : String(raw)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        );
      }}
    </FormField>
  );
}

export function NumberField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  placeholder,
  step = "any",
  min,
  max,
  disabled,
  ...props
}: BoundProps<TFieldValues, TName> & {
  placeholder?: string;
  step?: string | number;
  min?: number;
  max?: number;
}) {
  return (
    <FormField {...props}>
      {(field, { id, invalid, describedBy }) => {
        const raw: unknown = field.value;
        return (
          <Input
            {...field}
            id={id}
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            placeholder={placeholder}
            disabled={disabled}
            value={raw === null || raw === undefined ? "" : String(raw)}
            // Emit a number so zod's z.number() validates without a coercion
            // step; "" stays undefined rather than becoming NaN.
            onChange={(event) => {
              const next = event.target.value;
              field.onChange(next === "" ? undefined : Number(next));
            }}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        );
      }}
    </FormField>
  );
}

export function TextareaField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  placeholder,
  rows = 3,
  disabled,
  ...props
}: BoundProps<TFieldValues, TName> & { placeholder?: string; rows?: number }) {
  return (
    <FormField {...props}>
      {(field, { id, invalid, describedBy }) => {
        const raw: unknown = field.value;
        return (
          <Textarea
            {...field}
            id={id}
            rows={rows}
            placeholder={placeholder}
            disabled={disabled}
            value={raw === null || raw === undefined ? "" : String(raw)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        );
      }}
    </FormField>
  );
}

export function SelectField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  options,
  placeholder = "Select…",
  disabled,
  ...props
}: BoundProps<TFieldValues, TName> & { options: SelectOption[]; placeholder?: string }) {
  return (
    <FormField {...props}>
      {(field, { id, invalid, describedBy }) => {
        const raw: unknown = field.value;
        return (
          <Select
            value={raw === null || raw === undefined ? "" : String(raw)}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <SelectTrigger
              id={id}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }}
    </FormField>
  );
}

export function CheckboxField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  description,
  disabled,
  className,
  control,
  name,
}: BoundProps<TFieldValues, TName>) {
  // The label sits beside the box, so this does not reuse FormField's layout.
  return (
    <FormField control={control} name={name} className={className}>
      {(field, { id, invalid, describedBy }) => (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={id}
            ref={field.ref}
            checked={Boolean(field.value)}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            onBlur={field.onBlur}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            {label && (
              <Label htmlFor={id} className="cursor-pointer font-normal">
                {label}
              </Label>
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
      )}
    </FormField>
  );
}

export function SwitchField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  label,
  description,
  disabled,
  className,
  control,
  name,
}: BoundProps<TFieldValues, TName>) {
  return (
    <FormField control={control} name={name} className={className}>
      {(field, { id }) => (
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            {label && (
              <Label htmlFor={id} className="cursor-pointer">
                {label}
              </Label>
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <Switch
            id={id}
            ref={field.ref}
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            disabled={disabled}
          />
        </div>
      )}
    </FormField>
  );
}

/**
 * Stores the value as an ISO "yyyy-MM-dd" string — the format the API expects
 * and the only one that survives a JSON round trip unambiguously.
 */
export function DateField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  placeholder = "Pick a date",
  disabled,
  fromDate,
  toDate: maxDate,
  ...props
}: BoundProps<TFieldValues, TName> & {
  placeholder?: string;
  fromDate?: Date;
  toDate?: Date;
}) {
  return (
    <FormField {...props}>
      {(field, { id, invalid, describedBy }) => {
        const raw: unknown = field.value;
        const selected = toDate(raw instanceof Date ? raw : typeof raw === "string" ? raw : null) ?? undefined;

        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id={id}
                ref={field.ref}
                variant="outline"
                disabled={disabled}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className={cn(
                  "w-full justify-start font-normal",
                  !selected && "text-muted-foreground",
                  invalid && "border-destructive",
                )}
              >
                <CalendarIcon />
                {selected ? formatDate(selected) : placeholder}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selected}
                onSelect={(date) => field.onChange(date ? toISODate(date) : undefined)}
                defaultMonth={selected}
                fromDate={fromDate}
                toDate={maxDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        );
      }}
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Server-side validation bridge
// ---------------------------------------------------------------------------

/**
 * Pushes a 422 field map from the API onto the form so the messages land under
 * the offending inputs instead of in a toast. Returns true when the error was
 * a validation failure and has been handled.
 *
 * Fields the form does not know about are attached to `root`, so a rule that
 * only exists server-side is still shown rather than silently swallowed.
 */
export function applyApiErrors<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  knownFields?: readonly string[],
): boolean {
  if (!isApiError(error) || !error.isValidation) return false;

  const orphans: string[] = [];

  for (const [field, messages] of Object.entries(error.errors)) {
    const message = messages[0];
    if (message === undefined) continue;

    if (knownFields && !knownFields.includes(field)) {
      orphans.push(message);
      continue;
    }

    setError(field as FieldPath<TFieldValues>, { type: "server", message });
  }

  const rootMessage = orphans.length > 0 ? orphans.join(" ") : Object.keys(error.errors).length === 0 ? error.message : undefined;
  if (rootMessage) {
    setError("root.serverError" as FieldPath<TFieldValues>, { type: "server", message: rootMessage });
  }

  return true;
}

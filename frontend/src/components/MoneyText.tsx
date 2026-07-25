import { DEFAULT_CURRENCY } from "@/lib/constants";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { cn, toNumber } from "@/lib/utils";

export interface MoneyTextProps {
  value: number | string | null | undefined;
  currency?: string;
  /** Green when positive, red when negative — for margins and adjustments. */
  colored?: boolean;
  /** Abbreviate to ₹1.2L / ₹3.4Cr. For stat tiles, never for ledgers. */
  short?: boolean;
  /** Drop the ".00" tail on whole amounts. */
  compactZeros?: boolean;
  /** Always show a leading + on positive values. */
  showSign?: boolean;
  /** Voided documents render struck through. */
  struck?: boolean;
  muted?: boolean;
  className?: string;
}

/**
 * Money is always right-aligned and tabular so digits line up down a column;
 * the parent cell decides alignment, this decides the glyphs.
 */
export function MoneyText({
  value,
  currency = DEFAULT_CURRENCY,
  colored = false,
  short = false,
  compactZeros = false,
  showSign = false,
  struck = false,
  muted = false,
  className,
}: MoneyTextProps) {
  const amount = toNumber(value, Number.NaN);
  const known = Number.isFinite(amount);

  const text = short
    ? formatMoneyShort(value, currency)
    : formatMoney(value, currency, { compactZeros });

  const signed = showSign && known && amount > 0 ? `+${text}` : text;

  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        muted && "text-muted-foreground",
        struck && "line-through opacity-60",
        colored && known && amount > 0 && "text-status-paid",
        colored && known && amount < 0 && "text-status-overdue",
        className,
      )}
      title={short && known ? formatMoney(value, currency) : undefined}
    >
      {signed}
    </span>
  );
}

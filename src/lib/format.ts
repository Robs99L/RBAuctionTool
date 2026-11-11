const moneyFormatters = new Map<string, Intl.NumberFormat>();
let timeFormatter: Intl.DateTimeFormat | undefined;

export function formatMoney(amount: number, currency = "EUR") {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
    });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function formatTime(value: string) {
  timeFormatter ??= new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return timeFormatter.format(new Date(value));
}

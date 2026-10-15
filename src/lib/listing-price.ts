export function parseListingPrice(value: string | number): number | null {
  const raw = String(value).trim();
  const text = raw.startsWith(".") ? `0${raw}` : raw;
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents / 100 : null;
}

export function formatListingPrice(value: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(value);
}

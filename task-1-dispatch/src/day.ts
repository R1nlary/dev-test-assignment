// @rev kc-31
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function almatyDate(iso: string): string {
  return new Date(Date.parse(iso) + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

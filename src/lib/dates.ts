import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';

type DateLike = Date | string | number | null | undefined;
type FormatDistanceToNowOptions = Parameters<typeof formatDistanceToNow>[1];

export function toValidDate(value: DateLike): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function safeFormat(value: DateLike, pattern: string, fallback = '--'): string {
  const date = toValidDate(value);
  return date ? format(date, pattern) : fallback;
}

export function safeFormatDistanceToNow(
  value: DateLike,
  options?: FormatDistanceToNowOptions,
  fallback = 'Recently',
): string {
  const date = toValidDate(value);
  return date ? formatDistanceToNow(date, options) : fallback;
}

export function isDateToday(value: DateLike): boolean {
  const date = toValidDate(value);
  return date ? isToday(date) : false;
}

export function isDateYesterday(value: DateLike): boolean {
  const date = toValidDate(value);
  return date ? isYesterday(date) : false;
}

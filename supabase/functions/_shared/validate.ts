/**
 * Input validation helpers for edge functions.
 * Lightweight validation without external dependencies.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Validates a string is a valid UUID v4 */
export function validateUUID(value: unknown, fieldName: string): string {
  if (
    typeof value !== 'string' ||
    !value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  ) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }
  return value;
}

/** Validates a string is a valid email */
export function validateEmail(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    throw new ValidationError(`${fieldName} must be a valid email address`);
  }
  return value;
}

/** Validates a required non-empty string */
export function validateString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required and must be a non-empty string`);
  }
  return value.trim();
}

/** Validates a value is one of allowed options */
export function validateEnum<T extends string>(value: unknown, fieldName: string, allowed: T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

/** Validates an optional field — returns undefined if missing */
export function optional<T>(
  validator: (v: unknown, f: string) => T,
  value: unknown,
  fieldName: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return validator(value, fieldName);
}

/** Parse and validate JSON body from a request */
export async function parseBody<T>(
  req: Request,
  validate: (body: Record<string, unknown>) => T,
): Promise<T> {
  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  return validate(raw);
}

import { z } from "zod";

/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
export const forbidden = (message = "You don't have access to this.") =>
  new HttpError(403, "forbidden", message);

/** Validates input against a schema and throws a 422 with per-field messages on failure. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  throw new HttpError(422, "validation_failed", "Some fields need attention.", fields);
}

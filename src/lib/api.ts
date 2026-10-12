/** Tiny typed fetch wrapper for route handlers: JSON in, JSON out, readable errors. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      message = j.error?.message ?? message;
      code = j.error?.code;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

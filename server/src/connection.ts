// What a connection test returns: the service's version, if it has one to say,
// or why it failed. Rejected credentials are fixed with a new API key, an
// unreachable service with a new address.
export type TestResult =
  | { ok: true; version?: string }
  | { ok: false; reason: "credentials" | "unreachable"; message: string };

export class ConnectionError extends Error {
  reason: "credentials" | "unreachable";

  constructor(reason: "credentials" | "unreachable", message: string) {
    super(message);
    this.reason = reason;
  }
}

const TIMEOUT_MS = 5000;

// Addresses are typed as host:port, with the scheme optional.
export function baseUrl(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// fetch with a timeout, failing with an error that says what to fix.
export async function send(service: string, address: string, url: string, init: RequestInit): Promise<Response> {
  if (address.trim() === "") throw new ConnectionError("unreachable", `${service} isn't set up`);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ConnectionError("unreachable", `Can't reach ${address}`);
  }
}

export async function test(check: () => Promise<string | void>): Promise<TestResult> {
  try {
    const version = await check();
    return version === undefined ? { ok: true } : { ok: true, version };
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error;
    return { ok: false, reason: error.reason, message: error.message };
  }
}

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import type { Store } from "./store.ts";

// One password for the whole dashboard, with no user. With none set the
// dashboard is open, as it is on a fresh install. Signing in gives a cookie
// holding a random token, and the database keeps only the token's hash, so
// signing out, or changing the password, ends sessions for good.

export const COOKIE = "trakarr_session";

const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// A wrong password locks its address out for a while after a few tries.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

// Kept as "scrypt:salt:hash", in hex.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${(await derive(password, salt, 64)).toString("hex")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(await derive(password, Buffer.from(salt, "hex"), expected.length), expected);
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export function createAuth({ config, store }: { config: Config; store: Store }) {
  const failures = new Map<string, { count: number; since: number }>();

  function tokenOf(req: IncomingMessage): string | undefined {
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [name, ...value] = part.trim().split("=");
      if (name === COOKIE) return value.join("=");
    }
    return undefined;
  }

  return {
    // Whether the dashboard asks for a password.
    required: () => config.auth().password !== "",

    signedIn(req: IncomingMessage): boolean {
      const token = tokenOf(req);
      const expires = token ? store.sessionExpires(hashOf(token)) : undefined;
      return expires !== undefined && expires > Date.now();
    },

    verify: (password: string) => checkPassword(password, config.auth().password),

    // The cookie that holds a new session.
    start(secure: boolean): string {
      const token = randomBytes(32).toString("hex");
      const now = Date.now();
      store.pruneSessions(now);
      store.addSession(hashOf(token), now + SESSION_DAYS * DAY);
      return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure ? "; Secure" : ""}`;
    },

    // Ends the request's session. Returns the cookie that clears it.
    end(req: IncomingMessage): string {
      const token = tokenOf(req);
      if (token) store.deleteSession(hashOf(token));
      return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
    },

    endAll: () => store.deleteSessions(),

    async setPassword(password: string) {
      config.saveAuth({ password: password === "" ? "" : await hashPassword(password) });
    },

    locked(address: string): boolean {
      const entry = failures.get(address);
      if (!entry) return false;
      if (Date.now() - entry.since > LOCK_MS) {
        failures.delete(address);
        return false;
      }
      return entry.count >= MAX_FAILURES;
    },

    failed(address: string) {
      const entry = failures.get(address);
      failures.set(address, entry && Date.now() - entry.since <= LOCK_MS ? { ...entry, count: entry.count + 1 } : { count: 1, since: Date.now() });
    },

    passed: (address: string) => failures.delete(address),
  };
}

export type Auth = ReturnType<typeof createAuth>;

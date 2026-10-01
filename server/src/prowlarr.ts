import type { Settings } from "./config.ts";
import { baseUrl, ConnectionError, send } from "./connection.ts";

// The few Prowlarr API v1 calls trakarr makes: its version, the indexers and
// sync profiles for the rule editor, and the switch of an indexer's profile.

export interface Indexer {
  id: number;
  name: string;
  appProfileId: number;
}

export interface SyncProfile {
  id: number;
  name: string;
}

export function createProwlarr({ address, apiKey }: Settings["prowlarr"]) {
  const base = `${baseUrl(address)}/api/v1/`;

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await send("Prowlarr", address, base + path, {
      ...init,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
    });
    if (res.status === 401) throw new ConnectionError("credentials", "API key rejected (401)");
    if (!res.ok) throw new ConnectionError("unreachable", `Prowlarr returned ${res.status} for ${path}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    version: async () => ((await call("system/status")) as { version: string }).version,
    indexers: async () =>
      ((await call("indexer")) as Indexer[]).map(({ id, name, appProfileId }) => ({ id, name, appProfileId })),
    profiles: async () => ((await call("appprofile")) as SyncProfile[]).map(({ id, name }) => ({ id, name })),
    // The bulk edit changes only the profile, skips the indexer test that a full
    // edit runs, and still makes Prowlarr sync the change to Radarr and Sonarr.
    setProfile: async (indexerId: number, profileId: number) => {
      await call("indexer/bulk", { method: "PUT", body: JSON.stringify({ ids: [indexerId], appProfileId: profileId }) });
    },
  };
}

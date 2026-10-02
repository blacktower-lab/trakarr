import type { Config, Settings } from "./config.ts";
import { baseUrl, ConnectionError, send } from "./connection.ts";
import type { Log } from "./log.ts";

// Notifications go to ntfy, published as JSON to the server's root, so a title
// or a message with accents needs no header encoding.

export interface Notification {
  title: string;
  message: string;
  // ntfy's 1 (min) to 5 (max). Unset is its default, 3.
  priority?: number;
}

export function createNtfy({ address, topic, token }: Settings["ntfy"]) {
  return {
    async publish({ title, message, priority }: Notification): Promise<void> {
      if (topic === "") throw new ConnectionError("unreachable", "ntfy has no topic yet");
      const res = await send("ntfy", address, `${baseUrl(address)}/`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ topic, title, message, ...(priority && { priority }) }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ConnectionError(
          "credentials",
          token ? `ntfy rejected the access token (${res.status})` : "ntfy asks for an access token and none is set",
        );
      }
      if (!res.ok) throw new ConnectionError("unreachable", `ntfy answered ${res.status}`);
    },
  };
}

// Sends what the watcher reports to whichever ntfy topic the settings name now.
// Nothing waits on it, so a slow or dead server never holds up a poll, and a
// failure is only logged. Without an address and a topic it does nothing.
export function createNotifier({ config, log }: { config: Config; log: Log }) {
  const pending = new Set<Promise<void>>();

  function notify(notification: Notification) {
    const settings = config.settings().ntfy;
    if (settings.address.trim() === "" || settings.topic === "") return;
    const sending = createNtfy(settings)
      .publish(notification)
      .then(
        () => log.info("notify", "Sent a notification", { title: notification.title, topic: settings.topic }),
        (error: unknown) =>
          log.warn("notify", "Couldn't send a notification", {
            title: notification.title,
            error: (error as Error).message,
          }),
      )
      .finally(() => pending.delete(sending));
    pending.add(sending);
  }

  return {
    notify,
    // Resolves once what's being sent has been, for the tests.
    settled: async () => {
      await Promise.all(pending);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;

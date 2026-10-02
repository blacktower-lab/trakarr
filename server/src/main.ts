import { join } from "node:path";
import { createApi } from "./api.ts";
import { CONFIG_DIR, openConfig } from "./config.ts";
import { createLog, LEVELS, type Level } from "./log.ts";
import { createNotifier } from "./notify.ts";
import { openStore } from "./store.ts";
import { createWatcher } from "./watcher.ts";

// Environment, like Seerr: PORT, LOG_LEVEL and CONFIG_DIRECTORY.
const PORT = Number(process.env.PORT ?? 7478);
const LOG_LEVEL = (LEVELS as readonly string[]).includes(process.env.LOG_LEVEL ?? "") ? (process.env.LOG_LEVEL as Level) : "info";

const HOUR = 60 * 60 * 1000;

const config = openConfig();
const store = openStore(join(CONFIG_DIR, "trakarr.db"));
const log = createLog(store, LOG_LEVEL);
const watcher = createWatcher({ config, store, log, notify: createNotifier({ config, log }).notify });

// Old log lines go every hour. A shorter retention saved in the settings applies right away.
const pruneLogs = () => store.pruneLogs(config.settings().logRetentionDays);
pruneLogs();
setInterval(pruneLogs, HOUR).unref();

const server = createApi({ config, store, log, watcher }).listen(PORT, () => {
  log.info("server", "trakarr started", { port: PORT, node: process.version, config: CONFIG_DIR });
  log.info("engine", "Loaded rules", { count: config.rules().length, testMode: config.settings().testMode });
  watcher.start();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    watcher.stop();
    server.close();
    store.close();
    process.exit(0);
  });
}

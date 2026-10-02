import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePoll } from "../hooks/usePoll";
import { api, type SavedSettings } from "./api";
import { createFormat, DEFAULT_PREFS, type Format, type Prefs } from "./format";
import { LANGUAGES, translator, type Translate } from "./i18n";

// The language, time zone and clock the dashboard shows in. They're saved in
// the settings, but the screen before signing in, and the first paint, have no
// settings to read, so the last ones seen are kept in the browser.

const STORAGE_KEY = "trakarr.prefs";

function cached(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Prefs> | null;
    if (saved && saved.language !== undefined && saved.language in LANGUAGES) {
      return {
        language: saved.language,
        timeZone: typeof saved.timeZone === "string" ? saved.timeZone : DEFAULT_PREFS.timeZone,
        clock: saved.clock === "12" ? "12" : "24",
      };
    }
  } catch {
    // Nothing usable was kept, so the defaults stand.
  }
  return DEFAULT_PREFS;
}

interface PrefsContext {
  prefs: Prefs;
  setPrefs: (prefs: Prefs) => void;
  t: Translate;
  format: Format;
}

const PrefsContext = createContext<PrefsContext>({
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
  t: translator(DEFAULT_PREFS.language),
  format: createFormat(DEFAULT_PREFS, translator(DEFAULT_PREFS.language)),
});

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState(cached);

  const value = useMemo<PrefsContext>(() => {
    const t = translator(prefs.language);
    return {
      prefs,
      setPrefs: (next) => {
        if (next.language === prefs.language && next.timeZone === prefs.timeZone && next.clock === prefs.clock) return;
        setState(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      },
      t,
      format: createFormat(prefs, t),
    };
  }, [prefs]);

  useEffect(() => {
    document.documentElement.lang = prefs.language;
  }, [prefs.language]);

  return <PrefsContext value={value}>{children}</PrefsContext>;
}

export const usePrefs = () => useContext(PrefsContext);
export const useT = () => useContext(PrefsContext).t;
export const useFormat = () => useContext(PrefsContext).format;

interface SettingsContext {
  data: SavedSettings | undefined;
  error: Error | undefined;
  refresh: () => void;
}

const SettingsContext = createContext<SettingsContext>({ data: undefined, error: undefined, refresh: () => {} });

// Loads the settings once the user is in, and again when one is saved. What
// they say about language, time zone and clock goes to the preferences.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = usePoll(api.settings, null);
  const { setPrefs } = usePrefs();
  const { data } = settings;

  useEffect(() => {
    if (data) setPrefs({ language: data.language, timeZone: data.timeZone, clock: data.clock });
  }, [data]);

  return <SettingsContext value={settings}>{children}</SettingsContext>;
}

export const useSettings = () => useContext(SettingsContext);

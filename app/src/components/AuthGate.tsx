import { Button, Card, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import "../../../assets/wordmark.css";
import { api, type Session } from "../lib/api";
import { useT } from "../lib/prefs";
import { FIELD_VARIANT } from "./Form";
import { Logo } from "./Logo";

interface Auth {
  // Whether the dashboard asks for a password.
  required: boolean;
  // Loads the session again, after the password was set or removed, or the user signed out.
  refresh: () => Promise<void>;
}

const AuthContext = createContext<Auth>({ required: false, refresh: async () => {} });

export function useAuth(): Auth {
  return useContext(AuthContext);
}

// Asks for the password before anything else shows, if the dashboard has one
// and this browser hasn't signed in. Any request the server turns away for
// having no session, say after the session expired, brings it back.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>();

  const refresh = useCallback(async () => {
    try {
      setSession(await api.session());
    } catch {
      // trakarr can't be reached, which the pages say. They'd ask again if it wanted a password.
      setSession({ required: false, authenticated: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
    api.onUnauthorized(() => setSession({ required: true, authenticated: false }));
  }, [refresh]);

  if (!session) return null;
  if (!session.authenticated) return <SignIn onSignedIn={refresh} />;
  return <AuthContext value={{ required: session.required, refresh }}>{children}</AuthContext>;
}

function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password === "" || busy) return;
    setBusy(true);
    try {
      await api.login(password);
      await onSignedIn();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-1.25">
          <Logo className="size-11" />
          <span className="wordmark text-[21px]">trakarr</span>
        </div>
        <div className="w-full">
          <Card>
            <Card.Content>
              <Form onSubmit={submit}>
                <div className="flex flex-col gap-4">
                  <TextField
                    variant={FIELD_VARIANT}
                    value={password}
                    onChange={(value) => {
                      setPassword(value);
                      setError(undefined);
                    }}
                    isInvalid={error !== undefined}
                    autoFocus
                  >
                    <Label>{t("Password")}</Label>
                    <Input type="password" autoComplete="current-password" />
                    <FieldError>{error}</FieldError>
                  </TextField>
                  <Button type="submit" isDisabled={password === "" || busy}>
                    {t("Sign in")}
                  </Button>
                </div>
              </Form>
            </Card.Content>
          </Card>
        </div>
      </div>
    </main>
  );
}

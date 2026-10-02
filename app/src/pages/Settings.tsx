import {
  Alert,
  Button,
  Card,
  Chip,
  Drawer,
  FieldError,
  Form,
  Input,
  Label,
  Modal,
  Spinner,
  TextField,
  Typography,
  toast,
  useMediaQuery,
  useOverlayState,
} from "@heroui/react";
import { CircleAlert, CircleCheck, LockOpen, PanelLeft, Unplug, Wrench } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../components/AuthGate";
import { Empty, Pending } from "../components/Empty";
import { CheckboxField, FIELD_VARIANT, SecretInput, SelectField } from "../components/Form";
import { Section } from "../components/Section";
import { usePoll } from "../hooks/usePoll";
import { api, type SavedSettings, type SettingsInput, type TestResult } from "../lib/api";
import { cx } from "../lib/cx";

const SECTIONS = {
  system: "System",
  integrations: "Integrations",
  "api-keys": "API keys",
  time: "Time & language",
  security: "Security",
  notifications: "Notifications",
};

type SectionId = keyof typeof SECTIONS;

const POLL_OPTIONS = { "2": "2 s", "5": "5 s", "10": "10 s", "30": "30 s" };

const RETENTION_OPTIONS = { "7": "7 days", "14": "14 days", "30": "30 days", "90": "90 days" };

// Saved secrets never reach the UI, so they show as a row of asterisks when set
// and their fields start empty. Typing one replaces it on save.
const REDACTED = "*".repeat(16);
const KEEP_SECRET = "Unchanged";

// The options, plus the saved value when it isn't one of them, say after
// settings.json was edited by hand.
function withSaved(items: Record<string, string>, saved: number, unit: string): Record<string, string> {
  return String(saved) in items ? items : { ...items, [saved]: `${saved} ${unit}` };
}

// The field a card's fix action opens the edit dialog on.
type Focus = "address" | "secret";

export function Settings() {
  const [section, setSection] = useState<SectionId>("system");
  // Loaded once. Saving a card loads it again.
  const settings = usePoll(api.settings, null);
  // HeroUI has no sidebar. Wide screens list the sections in vertical tabs;
  // narrow ones keep them in a drawer.
  const wide = useMediaQuery("(min-width: 768px)");
  // The sections that are built. The others are still empty.
  const built = section !== "api-keys" && section !== "time";

  const content =
    built && settings.data ? (
      section === "system" ? (
        <GeneralCard saved={settings.data} onSaved={settings.refresh} />
      ) : (
        // Blocks of the same size, as many to a row as fit.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-6">
          {section === "integrations" ? (
            <>
              <QbittorrentCard saved={settings.data} onSaved={settings.refresh} />
              <ProwlarrCard saved={settings.data} onSaved={settings.refresh} />
            </>
          ) : section === "security" ? (
            <PasswordCard />
          ) : (
            <NtfyCard saved={settings.data} onSaved={settings.refresh} />
          )}
        </div>
      )
    ) : (
      <Card>{built ? <Pending error={settings.error} /> : <Empty icon={Wrench} title="Not in this mockup yet" />}</Card>
    );

  return (
    <div className="flex items-start gap-10">
      {wide && <SectionMenu section={section} onSelect={setSection} />}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {wide ? (
          <Section title={SECTIONS[section]}>{content}</Section>
        ) : (
          // The drawer's bar already names the section.
          <>
            <SectionDrawer section={section} onSelect={setSection} />
            {content}
          </>
        )}
      </div>
    </div>
  );
}

interface SectionNavProps {
  section: SectionId;
  onSelect: (id: SectionId) => void;
}

// The sections' own menu, like the page menu but vertical: muted sections, and
// the current one in the text color with a line on the left, also in the text
// color. HeroUI's tabs draw that line in the accent, with no prop to change it.
function SectionMenu({ section, onSelect }: SectionNavProps) {
  return (
    <nav aria-label="Settings sections" className="self-start border-s border-separator">
      <ul className="flex flex-col">
        {(Object.keys(SECTIONS) as SectionId[]).map((id) => {
          const selected = id === section;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(id)}
                className={cx(
                  "relative flex w-full cursor-(--cursor-interactive) items-center px-4 py-2 text-start text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:status-focused motion-reduce:transition-none",
                  selected ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {SECTIONS[id]}
                {selected && <span aria-hidden className="absolute inset-y-0 -start-px w-0.5 bg-foreground" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Names the current section and opens the others in a drawer, which closes
// when one is picked.
function SectionDrawer({ section, onSelect }: SectionNavProps) {
  const drawer = useOverlayState();

  return (
    <div className="flex items-center gap-2">
      <Drawer state={drawer}>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Settings sections">
          <PanelLeft aria-hidden />
        </Button>
        <Drawer.Backdrop>
          <Drawer.Content placement="left">
            <Drawer.Dialog>
              <Drawer.CloseTrigger />
              <Drawer.Header>
                <Drawer.Heading>Settings</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body>
                <SectionMenu
                  section={section}
                  onSelect={(id) => {
                    onSelect(id);
                    drawer.close();
                  }}
                />
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
      <Typography weight="medium">{SECTIONS[section]}</Typography>
    </div>
  );
}

interface CardProps {
  saved: SavedSettings;
  // Called once a change is saved, so the settings are loaded again.
  onSaved: () => void;
}

function GeneralCard({ saved, onSaved }: CardProps) {
  const [testMode, setTestMode] = useState(saved.testMode);
  const [retention, setRetention] = useState(String(saved.logRetentionDays));

  // Each field saves as it changes, and goes back to what was saved if that fails.
  const changeTestMode = async (value: boolean) => {
    setTestMode(value);
    if (!(await saveSettings("General", { testMode: value }, onSaved))) setTestMode(saved.testMode);
  };
  const changeRetention = async (value: string) => {
    setRetention(value);
    if (!(await saveSettings("General", { logRetentionDays: Number(value) }, onSaved))) {
      setRetention(String(saved.logRetentionDays));
    }
  };

  return (
    <SettingsCard
      body={
        <div className="flex flex-col gap-8">
          <CheckboxField
            label="Test mode"
            description="Logs what would be held or released, and changes nothing"
            isSelected={testMode}
            onChange={changeTestMode}
          />
          <div className="w-full max-w-64">
            <SelectField
              label="Log retention"
              value={retention}
              onValueChange={changeRetention}
              items={withSaved(RETENTION_OPTIONS, saved.logRetentionDays, "days")}
            />
          </div>
        </div>
      }
    />
  );
}

interface FormProps {
  saved: SavedSettings;
  // The field to start on when a card's fix action opened the dialog.
  focus?: Focus;
  onSave: (patch: SettingsInput) => Promise<unknown>;
}

function QbittorrentCard({ saved: settings, onSaved }: CardProps) {
  const saved = settings.qbittorrent;
  const service = useService("qBittorrent", saved.address !== "", () => api.testQbittorrent(), onSaved);

  return (
    <>
      <ServiceCard
        name="qBittorrent"
        configured={saved.address !== ""}
        result={service.result}
        onEdit={service.edit}
        secret="API key"
      >
        {/* Read in the same order as the edit form's fields. */}
        <Detail label="Address" subtle={!saved.address}>
          {saved.address || "None"}
        </Detail>
        <Detail label="Poll interval">{settings.pollSeconds} s</Detail>
        <Detail label="API key" subtle>
          {saved.hasApiKey ? REDACTED : "None"}
        </Detail>
      </ServiceCard>
      <EditDialog {...service.dialog}>
        <QbittorrentForm key={service.session} saved={settings} focus={service.focus} onSave={service.save} />
      </EditDialog>
    </>
  );
}

function QbittorrentForm({ saved: settings, focus, onSave }: FormProps) {
  const saved = settings.qbittorrent;
  const [address, setAddress] = useState(saved.address);
  const [apiKey, setApiKey] = useState("");
  const [poll, setPoll] = useState(String(settings.pollSeconds));
  const error = addressError(address);
  const draft = { address: address.trim(), apiKey };

  return (
    <EditForm
      title="Edit qBittorrent"
      valid={!error}
      dirty={draft.address !== saved.address || poll !== String(settings.pollSeconds) || apiKey !== ""}
      test={{ values: [draft.address, apiKey], run: () => api.testQbittorrent(draft) }}
      onSave={() => onSave({ qbittorrent: draft, pollSeconds: Number(poll) })}
    >
      <AddressField value={address} onChange={setAddress} error={error} autoFocus={focus === "address"} />
      <SelectField
        label="Poll interval"
        value={poll}
        onValueChange={setPoll}
        items={withSaved(POLL_OPTIONS, settings.pollSeconds, "s")}
      />
      <SecretInput
        label="API key"
        placeholder={KEEP_SECRET}
        value={apiKey}
        onChange={setApiKey}
        autoFocus={focus === "secret"}
      />
    </EditForm>
  );
}

function ProwlarrCard({ saved: settings, onSaved }: CardProps) {
  const saved = settings.prowlarr;
  const service = useService("Prowlarr", saved.address !== "", () => api.testProwlarr(), onSaved);

  return (
    <>
      <ServiceCard
        name="Prowlarr"
        configured={saved.address !== ""}
        result={service.result}
        onEdit={service.edit}
        secret="API key"
      >
        <Detail label="Address" subtle={!saved.address}>
          {saved.address || "None"}
        </Detail>
        <Detail label="API key" subtle>
          {saved.hasApiKey ? REDACTED : "None"}
        </Detail>
      </ServiceCard>
      <EditDialog {...service.dialog}>
        <ProwlarrForm key={service.session} saved={settings} focus={service.focus} onSave={service.save} />
      </EditDialog>
    </>
  );
}

function ProwlarrForm({ saved: settings, focus, onSave }: FormProps) {
  const saved = settings.prowlarr;
  const [address, setAddress] = useState(saved.address);
  const [apiKey, setApiKey] = useState("");
  const error = addressError(address);
  const draft = { address: address.trim(), apiKey };

  return (
    <EditForm
      title="Edit Prowlarr"
      valid={!error}
      dirty={draft.address !== saved.address || apiKey !== ""}
      test={{ values: [draft.address, apiKey], run: () => api.testProwlarr(draft) }}
      onSave={() => onSave({ prowlarr: draft })}
    >
      <AddressField value={address} onChange={setAddress} error={error} autoFocus={focus === "address"} />
      <SecretInput
        label="API key"
        placeholder={KEEP_SECRET}
        value={apiKey}
        onChange={setApiKey}
        autoFocus={focus === "secret"}
      />
    </EditForm>
  );
}

// The dashboard's one password. With none set it's open, and signing out only
// shows when there's one to sign in with.
function PasswordCard() {
  const { required, refresh } = useAuth();
  const [dialog, setDialog] = useState({ open: false, session: 0, remove: false });
  const show = (remove: boolean) => setDialog((current) => ({ open: true, session: current.session + 1, remove }));

  const signOut = async () => {
    try {
      await api.logout();
    } catch (error) {
      toast.danger("Couldn't sign out", { description: (error as Error).message });
      return;
    }
    await refresh();
  };

  // A failed change keeps the dialog open, so what was typed isn't lost.
  const save = async (change: { current?: string; next: string }, done: string): Promise<boolean> => {
    try {
      await api.setPassword(change);
    } catch (error) {
      toast.danger("Couldn't change the password", { description: (error as Error).message });
      return false;
    }
    toast.success(`Password ${done}`);
    setDialog((current) => ({ ...current, open: false }));
    await refresh();
    return true;
  };

  return (
    <>
      <SettingsCard
        title="Password"
        actions={
          required ? (
            <>
              <Button size="sm" variant="secondary" aria-label="Change password" onPress={() => show(false)}>
                Change
              </Button>
              <Button size="sm" variant="secondary" aria-label="Remove password" onPress={() => show(true)}>
                Remove
              </Button>
              <Button size="sm" variant="secondary" onPress={signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" aria-label="Set password" onPress={() => show(false)}>
              Set
            </Button>
          )
        }
        body={required ? undefined : <Empty icon={LockOpen} title="No password" />}
      />
      <EditDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      >
        <PasswordForm key={dialog.session} required={required} remove={dialog.remove} onSave={save} />
      </EditDialog>
    </>
  );
}

// server/src/config.ts
const MIN_PASSWORD = 8;

interface PasswordFormProps {
  // Whether there's a password now, which a change has to know.
  required: boolean;
  // Takes the password away, instead of setting a new one.
  remove: boolean;
  onSave: (change: { current?: string; next: string }, done: string) => Promise<unknown>;
}

function PasswordForm({ required, remove, onSave }: PasswordFormProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const tooShort = next !== "" && next.length < MIN_PASSWORD;
  const differs = again !== "" && again !== next;
  const valid = remove
    ? current !== ""
    : (!required || current !== "") && next.length >= MIN_PASSWORD && again === next;

  return (
    <EditForm
      title={remove ? "Remove password" : required ? "Change password" : "Set password"}
      submitLabel={remove ? "Remove" : "Save"}
      valid={valid}
      dirty
      onSave={() =>
        remove
          ? onSave({ current, next: "" }, "removed")
          : onSave({ ...(required && { current }), next }, required ? "changed" : "set")
      }
    >
      {(required || remove) && <SecretInput label="Current password" value={current} onChange={setCurrent} autoFocus />}
      {!remove && (
        <>
          <SecretInput
            label="New password"
            value={next}
            onChange={setNext}
            autoFocus={!required}
            error={tooShort ? `Use at least ${MIN_PASSWORD} characters` : undefined}
          />
          <SecretInput
            label="Repeat the new password"
            value={again}
            onChange={setAgain}
            error={differs ? "The passwords don't match" : undefined}
          />
        </>
      )}
    </EditForm>
  );
}

// Where trakarr sends what it does and what goes wrong. Nothing tests it as the
// card shows, since a test sends a real notification.
function NtfyCard({ saved: settings, onSaved }: CardProps) {
  const saved = settings.ntfy;
  const editor = useEditor("ntfy", onSaved);
  const configured = saved.address !== "" && saved.topic !== "";

  return (
    <>
      <ServiceCard name="ntfy" configured={configured} result={undefined} onEdit={editor.edit} secret="access token">
        <Detail label="Address" subtle={!saved.address}>
          {saved.address || "None"}
        </Detail>
        <Detail label="Topic" subtle={!saved.topic}>
          {saved.topic || "None"}
        </Detail>
        <Detail label="Access token" subtle>
          {saved.hasToken ? REDACTED : "None"}
        </Detail>
      </ServiceCard>
      <EditDialog {...editor.dialog}>
        <NtfyForm key={editor.session} saved={settings} focus={editor.focus} onSave={editor.save} />
      </EditDialog>
    </>
  );
}

function NtfyForm({ saved: settings, focus, onSave }: FormProps) {
  const saved = settings.ntfy;
  const [address, setAddress] = useState(saved.address);
  const [topic, setTopic] = useState(saved.topic);
  const [token, setToken] = useState("");
  const addressProblem = addressError(address);
  const topicProblem = topicError(topic);
  const draft = { address: address.trim(), topic: topic.trim(), token };

  return (
    <EditForm
      title="Edit ntfy"
      valid={!addressProblem && !topicProblem}
      dirty={draft.address !== saved.address || draft.topic !== saved.topic || token !== ""}
      test={{ values: [draft.address, draft.topic, token], run: () => api.testNtfy(draft) }}
      onSave={() => onSave({ ntfy: draft })}
    >
      <AddressField
        value={address}
        onChange={setAddress}
        error={addressProblem}
        autoFocus={focus === "address"}
        placeholder="https://ntfy.sh"
      />
      <TextField variant={FIELD_VARIANT} value={topic} onChange={setTopic} isInvalid={topicProblem !== undefined}>
        <Label>Topic</Label>
        <Input placeholder="trakarr" />
        <FieldError>{topicProblem}</FieldError>
      </TextField>
      <SecretInput
        label="Access token"
        placeholder={KEEP_SECRET}
        value={token}
        onChange={setToken}
        autoFocus={focus === "secret"}
      />
    </EditForm>
  );
}

function addressError(address: string): string | undefined {
  return address.trim() === "" ? "Enter an address" : undefined;
}

// ntfy's own limits on a topic's name.
function topicError(topic: string): string | undefined {
  if (topic.trim() === "") return "Enter a topic";
  return /^[-_A-Za-z0-9]{1,64}$/.test(topic.trim()) ? undefined : "Use up to 64 letters, numbers, - and _";
}

interface AddressFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus: boolean;
  placeholder?: string;
}

function AddressField({ value, onChange, error, autoFocus, placeholder = "host:port" }: AddressFieldProps) {
  return (
    <TextField
      variant={FIELD_VARIANT}
      value={value}
      onChange={onChange}
      isInvalid={error !== undefined}
      autoFocus={autoFocus}
    >
      <Label>Address</Label>
      <Input placeholder={placeholder} />
      <FieldError>{error}</FieldError>
    </TextField>
  );
}

interface SettingsCardProps {
  // A card with none has no header, since its section already says what it is.
  title?: string;
  // Beside the title.
  status?: ReactNode;
  actions?: ReactNode;
  alert?: ReactNode;
  // The details list. A card without one is only its header, or has a body in
  // its place.
  children?: ReactNode;
  // What stands in place of the details list: an empty message, or fields.
  body?: ReactNode;
}

function SettingsCard({ title, status, actions, alert, children, body }: SettingsCardProps) {
  return (
    <Card>
      {title && (
        <div className="flex flex-wrap items-center gap-3">
          <Card.Header>
            <Card.Title>{title}</Card.Title>
          </Card.Header>
          {status}
          {actions && <div className="ml-auto flex gap-2">{actions}</div>}
        </div>
      )}
      {(children || body) && (
        <Card.Content>
          <div className="flex flex-col gap-4">
            {alert}
            {children ? <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl> : body}
          </div>
        </Card.Content>
      )}
    </Card>
  );
}

interface ServiceCardProps {
  name: string;
  // A service with no address hasn't been set up, and only offers to connect.
  configured: boolean;
  // What the last test of the saved settings returned. None until it ends.
  result: TestResult | undefined;
  onEdit: (focus?: Focus) => void;
  // What the service's credential is called, for the fix action.
  secret: string;
  children: ReactNode;
}

function ServiceCard({ name, configured, result, onEdit, secret, children }: ServiceCardProps) {
  if (!configured) {
    return (
      <SettingsCard
        title={name}
        actions={
          <Button size="sm" variant="secondary" aria-label={`Connect ${name}`} onPress={() => onEdit("address")}>
            Connect
          </Button>
        }
        body={<Empty icon={Unplug} title="Not connected" />}
      />
    );
  }

  return (
    <SettingsCard
      title={name}
      status={
        result && (
          <>
            <Chip size="sm" variant="soft" color={result.ok ? "success" : "danger"}>
              {result.ok ? "Connected" : "Can't connect"}
            </Chip>
            {result.ok && (
              <Typography type="body-sm" color="muted">
                {result.version}
              </Typography>
            )}
          </>
        )
      }
      actions={
        <Button size="sm" variant="secondary" aria-label={`Edit ${name}`} onPress={() => onEdit()}>
          Edit
        </Button>
      }
      alert={
        result &&
        !result.ok && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{result.message}</Alert.Title>
            </Alert.Content>
            {result.reason === "credentials" ? (
              <Button size="sm" variant="secondary" onPress={() => onEdit("secret")}>
                Update {secret}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onPress={() => onEdit("address")}>
                Edit address
              </Button>
            )}
          </Alert>
        )
      }
    >
      {children}
    </SettingsCard>
  );
}

function Detail({ label, subtle, children }: { label: string; subtle?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("truncate", subtle && "text-muted")}>{children}</dd>
    </div>
  );
}

interface TestButtonProps {
  testing: boolean;
  onPress: () => void;
  isDisabled?: boolean;
}

// HeroUI's pending state blocks presses but draws nothing, so the button adds
// its spinner and label, as HeroUI's docs do.
function TestButton({ testing, ...props }: TestButtonProps) {
  return (
    <Button variant="secondary" isPending={testing} {...props}>
      {({ isPending }) => (
        <>
          {isPending && <Spinner size="sm" color="current" />}
          {isPending ? "Testing" : "Test"}
        </>
      )}
    </Button>
  );
}

// Saves settings and says so, or says why it couldn't. Reports whether it saved.
async function saveSettings(name: string, patch: SettingsInput, onSaved: () => void): Promise<boolean> {
  try {
    await api.saveSettings(patch);
  } catch (error) {
    toast.danger(`Couldn't save ${name}`, { description: (error as Error).message });
    return false;
  }
  toast.success(`${name} saved`);
  onSaved();
  return true;
}

// A card's edit dialog. Saving closes it, unless the save fails.
function useEditor(name: string, onSaved: () => void) {
  const [editor, setEditor] = useState<{ open: boolean; session: number; focus?: Focus }>({ open: false, session: 0 });

  return {
    session: editor.session,
    focus: editor.focus,
    // The session changes on every open so the form starts from the saved settings.
    edit: (focus?: Focus) => setEditor((current) => ({ open: true, session: current.session + 1, focus })),
    // Says whether the settings were saved.
    save: async (patch: SettingsInput): Promise<boolean> => {
      const saved = await saveSettings(name, patch, onSaved);
      if (saved) setEditor((current) => ({ ...current, open: false }));
      return saved;
    },
    dialog: {
      open: editor.open,
      onOpenChange: (open: boolean) => setEditor((current) => ({ ...current, open })),
    },
  };
}

// A service's connection test and its edit dialog. The saved settings are
// tested when the card shows, unless there's nothing set up to test, and again
// after they change.
function useService(name: string, configured: boolean, test: () => Promise<TestResult>, onSaved: () => void) {
  const editor = useEditor(name, onSaved);
  const [result, setResult] = useState<TestResult>();

  // Only fails if trakarr itself can't be reached, which says nothing of the service.
  const run = async () => {
    try {
      setResult(await test());
    } catch (error) {
      toast.danger(`Couldn't test ${name}`, { description: (error as Error).message });
    }
  };

  useEffect(() => {
    if (configured) void run();
    // Once, when the card shows.
  }, []);

  return {
    ...editor,
    result,
    // Saving tests the new settings, so the card shows whether they work. Until
    // then it shows nothing, not the result of the old ones.
    save: async (patch: SettingsInput) => {
      if (!(await editor.save(patch))) return;
      setResult(undefined);
      void run();
    },
  };
}

interface EditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

function EditDialog({ open, onOpenChange, children }: EditDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog>{children}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

interface EditFormProps {
  title: string;
  // What the button that saves says.
  submitLabel?: string;
  valid: boolean;
  // Whether anything differs from the saved settings.
  dirty: boolean;
  // For a form that has a connection to test: the values a test depends on,
  // where changing one clears its result, and how to run it.
  test?: { values: unknown[]; run: () => Promise<TestResult> };
  onSave: () => Promise<unknown>;
  children: ReactNode;
}

function EditForm({ title, submitLabel = "Save", valid, dirty, test, onSave, children }: EditFormProps) {
  const formId = useId();
  const key = JSON.stringify(test?.values ?? []);
  const [tested, setTested] = useState<{ key: string; result: TestResult | "testing" } | null>(null);
  const [saving, setSaving] = useState(false);
  const outcome = tested && tested.key === key ? tested.result : null;

  const runTest = async () => {
    if (!test) return;
    setTested({ key, result: "testing" });
    try {
      const result = await test.run();
      setTested((current) => (current?.key === key ? { key, result } : current));
    } catch (error) {
      // Trakarr itself can't be reached, so there's no result to show.
      setTested((current) => (current?.key === key ? null : current));
      toast.danger((error as Error).message);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !dirty || saving) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>{title}</Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        {/* The footer's Save button submits this form, so Enter in a field saves too. */}
        <Form id={formId} onSubmit={submit}>
          <div className="flex flex-col gap-4">{children}</div>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        {test && (
          <>
            <TestButton testing={outcome === "testing"} isDisabled={!valid} onPress={runTest} />
            <TestOutcome outcome={outcome} />
          </>
        )}
        <Button slot="close" variant="secondary">
          Cancel
        </Button>
        <Button type="submit" form={formId} isDisabled={!valid || !dirty || saving}>
          {submitLabel}
        </Button>
      </Modal.Footer>
    </>
  );
}

// What the last test of the form's values found, next to the Test button.
function TestOutcome({ outcome }: { outcome: TestResult | "testing" | null }) {
  const result = outcome === "testing" ? null : outcome;

  return (
    <p
      aria-live="polite"
      className={cx(
        "mr-auto flex min-w-0 items-center gap-1.5 text-sm",
        result && (result.ok ? "text-success" : "text-danger"),
      )}
    >
      {result &&
        (result.ok ? (
          <CircleCheck aria-hidden className="size-4 shrink-0" />
        ) : (
          <CircleAlert aria-hidden className="size-4 shrink-0" />
        ))}
      {result && (
        <span className="truncate">
          {result.ok ? (result.version ? `Connected · ${result.version}` : "Sent") : result.message}
        </span>
      )}
    </p>
  );
}

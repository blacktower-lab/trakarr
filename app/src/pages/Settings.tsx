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
  Tabs,
  TextField,
  Typography,
  toast,
  useMediaQuery,
  useOverlayState,
} from "@heroui/react";
import { CircleAlert, CircleCheck, PanelLeft, Unplug, Wrench } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Empty, Pending } from "../components/Empty";
import { FIELD_VARIANT, SecretInput, SelectField, SwitchField } from "../components/Form";
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

// Saved secrets never reach the UI, so they show as *** when set and their
// fields start empty. Typing one replaces it on save.
const REDACTED = "***";
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
  const built = section === "system" || section === "integrations";

  const content =
    built && settings.data ? (
      section === "system" ? (
        <GeneralCard saved={settings.data} onSaved={settings.refresh} />
      ) : (
        // Blocks of the same size, as many to a row as fit.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-6">
          <QbittorrentCard saved={settings.data} onSaved={settings.refresh} />
          <ProwlarrCard saved={settings.data} onSaved={settings.refresh} />
        </div>
      )
    ) : (
      <Card>{built ? <Pending error={settings.error} /> : <Empty icon={Wrench} title="Not in this mockup yet" />}</Card>
    );

  return (
    <div className="flex items-start gap-10">
      {wide && <SectionTabs section={section} onSelect={setSection} />}
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

function SectionTabs({ section, onSelect }: SectionNavProps) {
  return (
    <Tabs variant="secondary" orientation="vertical" align="start" selectedKey={section} onSelectionChange={(key) => onSelect(key as SectionId)}>
      <Tabs.ListContainer>
        <Tabs.List aria-label="Settings sections">
          {(Object.keys(SECTIONS) as SectionId[]).map((id) => (
            <Tabs.Tab key={id} id={id}>
              {SECTIONS[id]}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
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
                <SectionTabs
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
          <SwitchField
            switchFirst
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

function addressError(address: string): string | undefined {
  return address.trim() === "" ? "Enter an address" : undefined;
}

interface AddressFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus: boolean;
}

function AddressField({ value, onChange, error, autoFocus }: AddressFieldProps) {
  return (
    <TextField
      variant={FIELD_VARIANT}
      value={value}
      onChange={onChange}
      isInvalid={error !== undefined}
      autoFocus={autoFocus}
    >
      <Label>Address</Label>
      <Input placeholder="host:port" />
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
  valid: boolean;
  // Whether anything differs from the saved settings.
  dirty: boolean;
  // For a form that has a connection to test: the values a test depends on,
  // where changing one clears its result, and how to run it.
  test?: { values: unknown[]; run: () => Promise<TestResult> };
  onSave: () => Promise<unknown>;
  children: ReactNode;
}

function EditForm({ title, valid, dirty, test, onSave, children }: EditFormProps) {
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
          Save
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
      {result && <span className="truncate">{result.ok ? `Connected · ${result.version}` : result.message}</span>}
    </p>
  );
}

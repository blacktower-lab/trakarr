import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Modal,
  NumberField,
  Separator,
  TextField,
} from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";
import { usePoll } from "../hooks/usePoll";
import { api, type HoldAction, type ProwlarrOptions, type RuleFields, type RuleState } from "../lib/api";
import { cx } from "../lib/cx";
import { BUFFER_THRESHOLDS, DEFAULT_THRESHOLDS, thresholdsOf, toGiB, type Rule } from "../lib/data";
import { msg, rich } from "../lib/i18n";
import { useFormat, useSettings, useT } from "../lib/prefs";
import { CheckboxField, FIELD_VARIANT, FormSection, PointDecimals, RadioField, ROW, SelectField } from "./Form";
import { UsageBar } from "./UsageBar";

interface RuleEditorProps {
  open: boolean;
  // The rule being edited, or none for a new one. It stays set while the dialog animates closed.
  rule: Rule | undefined;
  // What a new rule starts from, over the usual defaults.
  draft?: Partial<Rule>;
  // Changes every time the dialog opens, so the form starts from the saved rule.
  // Zero before the first time.
  session: number;
  onOpenChange: (open: boolean) => void;
  // Resolves once the save is over. The caller closes the dialog if it worked.
  onSave: (fields: RuleFields) => Promise<void>;
}

export function RuleEditor({ open, rule, draft, session, onOpenChange, onSave }: RuleEditorProps) {
  const t = useT();
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      {/* Large keeps the paired fields side by side (see ROW). */}
      <Modal.Container size="lg" scroll="inside">
        {/* No visible title, so the dialog is named here. */}
        <Modal.Dialog aria-label={rule ? t("Edit rule") : t("New rule")}>
          {session > 0 && <RuleForm key={session} rule={rule ?? { ...NEW_RULE, ...draft }} onSave={onSave} />}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

// Domains are typed as a list split by commas or spaces.
function splitList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

// Keeps only the host when an announce URL is pasted, so the passkey in its
// path never reaches the rule.
function toDomain(value: string): string {
  const text = value.toLowerCase();
  try {
    return new URL(text.includes("://") ? text : `https://${text}`).hostname;
  } catch {
    return text;
  }
}

function isDomain(value: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value);
}

// A new rule starts from the usual thresholds, with nothing matched yet.
const NEW_RULE: Rule = {
  id: "",
  name: "",
  domains: [],
  ...DEFAULT_THRESHOLDS,
  byBuffer: false,
  action: "throttle",
  prowlarr: null,
  enabled: true,
  uploadedGiB: 0,
  downloadedGiB: 0,
  torrents: 0,
  state: "ok",
};

// What each hold action does, shown under its radio. Both are translated where they show.
export const ACTIONS: Record<HoldAction, { label: string; description: string }> = {
  throttle: { label: msg("Throttle"), description: msg("Limits it to 1 KiB/s, keeps seeding") },
  stop: { label: msg("Stop"), description: msg("Stops the download") },
};

// Ratios show two decimals, like everywhere else on the page.
const RATIO_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

// How long typing stops before the match is previewed.
const PREVIEW_DELAY_MS = 300;

function RuleForm({ rule, onSave }: { rule: Rule; onSave: (fields: RuleFields) => Promise<void> }) {
  const t = useT();
  const format = useFormat();
  const [name, setName] = useState(rule.name);
  const [domainsText, setDomainsText] = useState(rule.domains.join(", "));
  const domains = [...new Set(splitList(domainsText).map(toDomain))];
  const badDomain = domains.find((d) => !isDomain(d));
  // A bad domain shows once the field is left, not while it's being typed.
  const [domainsLeft, setDomainsLeft] = useState(true);
  // NaN while a ratio field is empty.
  const [hold, setHold] = useState(rule.holdBelow);
  const [release, setRelease] = useState(rule.releaseAbove);
  const [byBuffer, setByBuffer] = useState(rule.byBuffer);
  const [action, setAction] = useState<HoldAction>(rule.action);
  // Whether a held rule's indexer changes sync profile, which Integrations sets for every rule.
  const switching = useSettings().data?.prowlarr.switchProfiles === true;
  // Ids as text, since the selects' keys are. Empty until an indexer is picked.
  const [indexerId, setIndexerId] = useState(rule.prowlarr ? String(rule.prowlarr.indexerId) : "");
  const [heldProfileId, setHeldProfileId] = useState(rule.prowlarr ? String(rule.prowlarr.heldProfileId) : "");
  const [restoreProfileId, setRestoreProfileId] = useState(rule.prowlarr ? String(rule.prowlarr.restoreProfileId) : "");
  const prowlarr = usePoll(api.prowlarr, null);
  const [saving, setSaving] = useState(false);

  const holdError = !(hold > 0) ? t("Enter a ratio above 0") : undefined;
  const releaseError = !(release > 0)
    ? t("Enter a ratio above 0")
    : hold > 0 && release <= hold
      ? t("Must be above Hold below")
      : undefined;
  // On the buffer the ratios don't count, so they can't be wrong.
  const errors = {
    name: name.trim() === "" ? t("Enter a name") : undefined,
    domains: badDomain ? t("{domain} isn't a domain", { domain: badDomain }) : undefined,
    match: domains.length === 0 ? t("Add a domain") : undefined,
    hold: byBuffer ? undefined : holdError,
    release: byBuffer ? undefined : releaseError,
  };
  const valid = Object.values(errors).every((e) => e === undefined);

  // What the server sees right now for this match: how many torrents it
  // reaches and their totals. It starts from the saved rule's numbers.
  const [reach, setReach] = useState({
    torrents: rule.torrents,
    uploadedGiB: rule.uploadedGiB,
    downloadedGiB: rule.downloadedGiB,
  });
  const matchKey = JSON.stringify(domains);
  useEffect(() => {
    if (badDomain || domains.length === 0) return;
    // Cleanup drops the answer to a match that was typed over since.
    let stale = false;
    const timer = window.setTimeout(() => {
      api.preview({ domains }).then(
        ({ torrents, uploaded, downloaded }) => {
          if (!stale) setReach({ torrents, uploadedGiB: toGiB(uploaded), downloadedGiB: toGiB(downloaded) });
        },
        () => {
          // The count stays as it was. Saving reports a server that is down.
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // domains is rebuilt on every render, so the effect follows its content.
  }, [matchKey]);

  const ratio = reach.downloadedGiB === 0 ? Infinity : reach.uploadedGiB / reach.downloadedGiB;
  const typed = {
    holdBelow: holdError ? rule.holdBelow : hold,
    releaseAbove: releaseError ? rule.releaseAbove : release,
    byBuffer,
  };
  const { holdBelow: holdAt, releaseAbove: releaseAt } = thresholdsOf(typed);
  const state: RuleState = ratio < holdAt ? "held" : ratio > releaseAt ? "ok" : rule.state;
  const shown: Rule = {
    ...rule,
    ...typed,
    state,
    uploadedGiB: reach.uploadedGiB,
    downloadedGiB: reach.downloadedGiB,
  };

  // Prowlarr's indexers and sync profiles, as select items. Until they load, or
  // if they can't, the selects are disabled and the saved ids stay as they are.
  const options = prowlarr.data;
  const unavailable = options === undefined;

  // The indexer's current profile is where it goes back to after a release.
  const pickIndexer = (key: string) => {
    setIndexerId(key === NO_INDEXER ? "" : key);
    const indexer = options?.indexers.find((i) => String(i.id) === key);
    if (!options || !indexer) return;
    setRestoreProfileId(String(indexer.appProfileId));
    if (heldProfileId === "") setHeldProfileId(defaultHeldProfile(options, indexer.appProfileId));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        domains,
        // Ratios nobody can read, left over from before the buffer was on, go as they were saved.
        holdBelow: holdError || releaseError ? rule.holdBelow : hold,
        releaseAbove: holdError || releaseError ? rule.releaseAbove : release,
        byBuffer,
        action,
        // With the switch off in Integrations, the editor has nothing of Prowlarr's, so the rule keeps what it had.
        prowlarr: !switching
          ? rule.prowlarr
          : indexerId === ""
            ? null
            : {
                indexerId: Number(indexerId),
                heldProfileId: Number(heldProfileId),
                restoreProfileId: Number(restoreProfileId),
              },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal.CloseTrigger />

      <Modal.Body>
        <div className="@container flex flex-col gap-6">
          <div className={ROW}>
            <TextField variant={FIELD_VARIANT} value={name} onChange={setName} isInvalid={errors.name !== undefined}>
              <Label>{t("Name")}</Label>
              <Input />
              <FieldError>{errors.name}</FieldError>
            </TextField>
            {/* Leaving the field swaps any pasted announce URL for its domain. */}
            <TextField
              variant={FIELD_VARIANT}
              value={domainsText}
              onChange={(text) => {
                setDomainsText(text);
                setDomainsLeft(false);
              }}
              onBlur={() => {
                setDomainsText(domains.join(", "));
                setDomainsLeft(true);
              }}
              isInvalid={domainsLeft && errors.domains !== undefined}
            >
              <Label>{t("Domains")}</Label>
              <Input placeholder={t("Domains or announce URLs, comma-separated")} />
              <FieldError>{errors.domains}</FieldError>
            </TextField>
          </div>

          {/* On the buffer the fields are disabled, and show the ratios it holds and releases at. */}
          <div className={ROW}>
            <RatioField
              label={t("Hold below")}
              value={byBuffer ? BUFFER_THRESHOLDS.holdBelow : hold}
              onChange={setHold}
              error={errors.hold}
              isDisabled={byBuffer}
            />
            <RatioField
              label={t("Release above")}
              value={byBuffer ? BUFFER_THRESHOLDS.releaseAbove : release}
              onChange={setRelease}
              error={errors.release}
              isDisabled={byBuffer}
            />
          </div>

          <CheckboxField
            label={t("Download based on buffer")}
            description={t("Downloads only while uploaded covers them, ignoring the ratios")}
            isSelected={byBuffer}
            onChange={setByBuffer}
          />

          <div className="flex flex-col gap-2">
            <UsageBar rule={shown} />
            <p className="text-sm text-muted">
              {byBuffer
                ? t("Download will continue until buffer is consumed.")
                : rich(t, "Below {hold} downloads pause, above {release} they continue.", {
                    hold: <Value>{format.number(holdAt, 2)}</Value>,
                    release: <Value>{format.number(releaseAt, 2)}</Value>,
                  })}
            </p>
          </div>

          <Separator />

          <FormSection title={t("When held")}>
            <RadioField
              label={t("When held")}
              value={action}
              onChange={setAction}
              options={(Object.keys(ACTIONS) as HoldAction[]).map((id) => ({
                id,
                label: t(ACTIONS[id].label),
                description: t(ACTIONS[id].description),
              }))}
            />
          </FormSection>

          {switching && (
            <>
              <Separator />

              <FormSection title="Prowlarr">
                <div className="flex flex-col gap-4">
                  {prowlarr.error && <Description>{prowlarr.error.message}</Description>}
                  <SelectField
                    label={t("Indexer")}
                    value={indexerId === "" ? NO_INDEXER : indexerId}
                    onValueChange={pickIndexer}
                    items={{ [NO_INDEXER]: t("None"), ...itemsOf(options?.indexers) }}
                    isDisabled={unavailable}
                  />
                  {indexerId !== "" && (
                    // Side by side at any width: both profiles have short names.
                    <div className="grid grid-cols-2 items-start gap-x-3">
                      <SelectField
                        label={t("While held")}
                        value={heldProfileId}
                        onValueChange={setHeldProfileId}
                        items={itemsOf(options?.profiles)}
                        isDisabled={unavailable}
                      />
                      <SelectField
                        label={t("After release")}
                        value={restoreProfileId}
                        onValueChange={setRestoreProfileId}
                        items={itemsOf(options?.profiles)}
                        isDisabled={unavailable}
                      />
                    </div>
                  )}
                </div>
              </FormSection>
            </>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <p className={cx("mr-auto text-sm", errors.match ? "text-danger" : "text-muted")}>
          {errors.match ??
            (reach.torrents === 1 ? t("1 torrent matches") : t("{count} torrents match", { count: reach.torrents }))}
        </p>
        <Button slot="close" variant="secondary">
          {t("Cancel")}
        </Button>
        <Button isDisabled={!valid || saving} onPress={save}>
          {t("Save")}
        </Button>
      </Modal.Footer>
    </>
  );
}

// The Indexer select's key for a rule with none, since a key can't be empty.
const NO_INDEXER = "none";

// Select items keyed by id.
function itemsOf(list: { id: number; name: string }[] = []): Record<string, string> {
  return Object.fromEntries(list.map(({ id, name }) => [String(id), name]));
}

// The profile a held indexer usually moves to: the first one it isn't on now.
function defaultHeldProfile({ profiles }: ProwlarrOptions, currentId: number): string {
  const other = profiles.find((profile) => profile.id !== currentId) ?? profiles[0];
  return other ? String(other.id) : "";
}

interface RatioFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  isDisabled?: boolean;
}

function RatioField({ label, value, onChange, error, isDisabled }: RatioFieldProps) {
  return (
    <PointDecimals>
      <NumberField
        variant={FIELD_VARIANT}
        value={value}
        onChange={onChange}
        minValue={0}
        step={0.01}
        formatOptions={RATIO_FORMAT}
        isInvalid={error !== undefined}
        isDisabled={isDisabled}
      >
        <Label>{label}</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError>{error}</FieldError>
      </NumberField>
    </PointDecimals>
  );
}

// A number in a line of text.
export function Value({ children }: { children: ReactNode }) {
  return <span className="font-medium tabular-nums text-foreground">{children}</span>;
}

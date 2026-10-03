import { Button, FieldError, Input, Label, Modal, NumberField, Separator, TextField } from "@heroui/react";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Purchase, QuotaChange } from "../lib/api";
import { freeleechLeft, ratioOf, toBytes, toGiB, type TrackerRow } from "../lib/data";
import { rich } from "../lib/i18n";
import { useFormat, useT } from "../lib/prefs";
import { FIELD_VARIANT, SwitchField } from "./Form";
import { Value } from "./RuleEditor";

interface QuotaEditorProps {
  open: boolean;
  // The tracker whose quota changes. It stays set while the dialog animates closed.
  tracker: TrackerRow | undefined;
  // Changes every time the dialog opens, so the form starts from the saved quota.
  // Zero before the first time.
  session: number;
  onOpenChange: (open: boolean) => void;
  // Resolves once the save is over. The caller closes the dialog if it worked.
  onSave: (change: QuotaChange) => Promise<void>;
  // Resolves with whether the purchase was saved. Either way the quota dialog stays open.
  onAddPurchase: (bytes: number) => Promise<boolean>;
  // Resolves once the purchase's deletion is over.
  onDeletePurchase: (id: string) => Promise<void>;
}

// What a tracker's site counts that qBittorrent doesn't: upload bought with
// bonus points, and a freeleech.
export function QuotaEditor({ open, tracker, session, onOpenChange, onSave, onAddPurchase, onDeletePurchase }: QuotaEditorProps) {
  // Whether the dialog to add a purchase is open. Its key changes every time it
  // opens, so it starts empty.
  const [adding, setAdding] = useState({ open: false, key: 0 });

  const add = async (bytes: number) => {
    if (await onAddPurchase(bytes)) setAdding((current) => ({ ...current, open: false }));
  };

  return (
    <>
      <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog>
            {session > 0 && tracker && (
              <QuotaForm
                key={session}
                tracker={tracker}
                onSave={onSave}
                onAddPurchase={() => setAdding((current) => ({ open: true, key: current.key + 1 }))}
                onDeletePurchase={onDeletePurchase}
              />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* A sibling of the quota dialog, not inside it, so each keeps its own focus. */}
      <Modal.Backdrop
        isOpen={open && adding.open}
        onOpenChange={(isOpen) => !isOpen && setAdding((current) => ({ ...current, open: false }))}
      >
        <Modal.Container>
          <Modal.Dialog>
            <PurchaseForm key={adding.key} onAdd={add} />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

// A freeleech usually lasts a day, and the server takes a month at most.
const DEFAULT_FREELEECH_HOURS = 24;
const MAX_FREELEECH_HOURS = 24 * 30;

const HOURS_FORMAT = { style: "unit", unit: "hour", unitDisplay: "long" } as const;

interface QuotaFormProps {
  tracker: TrackerRow;
  onSave: (change: QuotaChange) => Promise<void>;
  onAddPurchase: () => void;
  onDeletePurchase: (id: string) => Promise<void>;
}

function QuotaForm({ tracker, onSave, onAddPurchase, onDeletePurchase }: QuotaFormProps) {
  const t = useT();
  const format = useFormat();
  const left = freeleechLeft(tracker.freeleech);
  const running = left > 0;
  const [freeleech, setFreeleech] = useState(running);
  const [hours, setHours] = useState(DEFAULT_FREELEECH_HOURS);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Hours only matter for a freeleech that starts on save.
  const starts = freeleech && !running;
  const errors = {
    hours:
      starts && !(Number.isInteger(hours) && hours >= 1 && hours <= MAX_FREELEECH_HOURS)
        ? t("Enter 1 to {max} hours", { max: MAX_FREELEECH_HOURS })
        : undefined,
  };
  const valid = Object.values(errors).every((e) => e === undefined);
  const change: QuotaChange = {
    ...(starts && { freeleechHours: hours }),
    ...(!freeleech && running && { freeleechHours: null }),
  };
  const changed = Object.keys(change).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(change);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await onDeletePurchase(id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>{t("Change quota")}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <div className="flex flex-col gap-6">
          <TextField variant={FIELD_VARIANT} value={tracker.name} isDisabled>
            <Label>{t("Tracker")}</Label>
            <Input />
          </TextField>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                {rich(t, "Total bought {size}", { size: <Value>{format.gib(tracker.boughtGiB)}</Value> })}
              </p>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t("Add purchase")} onPress={onAddPurchase}>
                <Plus aria-hidden />
              </Button>
            </div>
            {tracker.purchases.length > 0 && (
              <PurchaseList purchases={tracker.purchases} isDisabled={deleting} onDelete={remove} />
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <SwitchField
              label={t("Freeleech")}
              description={
                running
                  ? freeleech
                    ? t("Ends in {time}", { time: format.left(left) })
                    : t("Ends when saved")
                  : t("Downloads don't count and nothing is held")
              }
              isSelected={freeleech}
              onChange={setFreeleech}
            />
            {starts && (
              <NumberField
                variant={FIELD_VARIANT}
                value={hours}
                onChange={setHours}
                minValue={1}
                maxValue={MAX_FREELEECH_HOURS}
                step={1}
                formatOptions={HOURS_FORMAT}
                isInvalid={errors.hours !== undefined}
              >
                <Label>{t("Duration")}</Label>
                <NumberField.Group>
                  <NumberField.DecrementButton />
                  <NumberField.Input />
                  <NumberField.IncrementButton />
                </NumberField.Group>
                <FieldError>{errors.hours}</FieldError>
              </NumberField>
            )}
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {/* The footer's buttons are at its end, so the margin takes the ratio to its start. */}
        <p className="mr-auto text-sm text-muted">
          {rich(t, "Ratio {ratio}", { ratio: <Value>{format.ratio(ratioOf(tracker))}</Value> })}
        </p>
        <Button slot="close" variant="secondary">
          {t("Cancel")}
        </Button>
        <Button isDisabled={!valid || !changed || saving} onPress={save}>
          {t("Save")}
        </Button>
      </Modal.Footer>
    </>
  );
}

interface PurchaseListProps {
  purchases: Purchase[];
  isDisabled: boolean;
  onDelete: (id: string) => void;
}

// Each purchase with its date, the newest first, and a button to delete it.
function PurchaseList({ purchases, isDisabled, onDelete }: PurchaseListProps) {
  const t = useT();
  const format = useFormat();

  return (
    <ul className="flex flex-col gap-2">
      {[...purchases].reverse().map((purchase) => (
        <li key={purchase.id} className="flex items-center gap-3">
          <span className="flex-1 text-sm text-muted">{purchase.at === null ? "—" : format.date(purchase.at)}</span>
          <Value>{format.gib(toGiB(purchase.bytes))}</Value>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t("Delete purchase")}
            isDisabled={isDisabled}
            onPress={() => onDelete(purchase.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}

// Digits with a point or a comma, as it's typed in either language.
const AMOUNT = /^(\d+[.,]?\d*|[.,]\d+)$/;

// How much upload was bought, to add as a purchase of today. It's a text field,
// not a number field, which only takes what's typed once it loses focus, and
// that would swallow the first click on Add.
function PurchaseForm({ onAdd }: { onAdd: (bytes: number) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const typed = text.trim();
  const bytes = AMOUNT.test(typed) ? toBytes(Number(typed.replace(",", "."))) : 0;
  const invalid = typed !== "" && bytes <= 0;

  const add = async () => {
    setAdding(true);
    try {
      await onAdd(bytes);
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>{t("Add purchase")}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <TextField variant={FIELD_VARIANT} value={text} onChange={setText} autoFocus isInvalid={invalid}>
          <Label>{t("Upload (GiB)")}</Label>
          <Input inputMode="decimal" placeholder="0" autoComplete="off" />
          <FieldError>{invalid ? t("Enter an amount above 0") : undefined}</FieldError>
        </TextField>
      </Modal.Body>

      <Modal.Footer>
        <Button slot="close" variant="secondary">
          {t("Cancel")}
        </Button>
        <Button isDisabled={bytes <= 0 || adding} onPress={add}>
          {t("Add")}
        </Button>
      </Modal.Footer>
    </>
  );
}

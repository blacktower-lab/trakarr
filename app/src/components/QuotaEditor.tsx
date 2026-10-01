import { Button, FieldError, Label, Modal, NumberField, Separator } from "@heroui/react";
import { useState } from "react";
import type { QuotaChange } from "../lib/api";
import { formatGiB, formatLeft, formatRatio, freeleechLeft, ratioOf, toBytes, type TrackerRow } from "../lib/data";
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
}

// What a tracker's site counts that qBittorrent doesn't: upload bought with
// bonus points, and a freeleech.
export function QuotaEditor({ open, tracker, session, onOpenChange, onSave }: QuotaEditorProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog>{session > 0 && tracker && <QuotaForm key={session} tracker={tracker} onSave={onSave} />}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

// A freeleech usually lasts a day, and the server takes a month at most.
const DEFAULT_FREELEECH_HOURS = 24;
const MAX_FREELEECH_HOURS = 24 * 30;

const GIB_FORMAT = { maximumFractionDigits: 2 };
const HOURS_FORMAT = { style: "unit", unit: "hour", unitDisplay: "long" } as const;

function QuotaForm({ tracker, onSave }: { tracker: TrackerRow; onSave: (change: QuotaChange) => Promise<void> }) {
  // NaN while the field is empty.
  const [add, setAdd] = useState(NaN);
  const left = freeleechLeft(tracker.freeleech);
  const running = left > 0;
  const [freeleech, setFreeleech] = useState(running);
  const [hours, setHours] = useState(DEFAULT_FREELEECH_HOURS);
  const [saving, setSaving] = useState(false);

  const added = Number.isNaN(add) ? 0 : add;
  // Hours only matter for a freeleech that starts on save.
  const starts = freeleech && !running;
  const errors = {
    add: tracker.boughtGiB + added < 0 ? `Only ${formatGiB(tracker.boughtGiB)} was bought` : undefined,
    hours:
      starts && !(Number.isInteger(hours) && hours >= 1 && hours <= MAX_FREELEECH_HOURS)
        ? `Enter 1 to ${MAX_FREELEECH_HOURS} hours`
        : undefined,
  };
  const valid = Object.values(errors).every((e) => e === undefined);
  const change: QuotaChange = {
    ...(added !== 0 && { addBought: toBytes(added) }),
    ...(starts && { freeleechHours: hours }),
    ...(!freeleech && running && { freeleechHours: null }),
  };
  const changed = Object.keys(change).length > 0;

  // What the ratio becomes with what's added, once it can be saved.
  const ratio = formatRatio(ratioOf(tracker));
  const next = errors.add
    ? ratio
    : formatRatio(ratioOf({ uploadedGiB: tracker.uploadedGiB + added, downloadedGiB: tracker.downloadedGiB }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(change);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>Change quota · {tracker.name}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Bought so far <Value>{formatGiB(tracker.boughtGiB)}</Value>
            </p>
            <NumberField
              variant={FIELD_VARIANT}
              value={add}
              onChange={setAdd}
              step={1}
              formatOptions={GIB_FORMAT}
              isInvalid={errors.add !== undefined}
            >
              <Label>Add upload (GiB)</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input placeholder="0" />
                <NumberField.IncrementButton />
              </NumberField.Group>
              <FieldError>{errors.add}</FieldError>
            </NumberField>
            <p className="text-sm text-muted">
              Ratio <Value>{ratio}</Value>
              {next !== ratio && (
                <>
                  {" "}
                  → <Value>{next}</Value>
                </>
              )}
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <SwitchField
              label="Freeleech"
              description={
                running
                  ? freeleech
                    ? `Ends in ${formatLeft(left)}`
                    : "Ends when saved"
                  : "Downloads don't count and nothing is held"
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
                <Label>Duration</Label>
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
        <Button slot="close" variant="secondary">
          Cancel
        </Button>
        <Button isDisabled={!valid || !changed || saving} onPress={save}>
          Save
        </Button>
      </Modal.Footer>
    </>
  );
}

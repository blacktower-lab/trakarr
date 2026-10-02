import { Button, FieldError, Label, Modal, NumberField, Separator } from "@heroui/react";
import { useState } from "react";
import type { QuotaChange } from "../lib/api";
import { freeleechLeft, ratioOf, toBytes, type TrackerRow } from "../lib/data";
import { rich } from "../lib/i18n";
import { useFormat, useT } from "../lib/prefs";
import { FIELD_VARIANT, PointDecimals, SwitchField } from "./Form";
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
  const t = useT();
  const format = useFormat();
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
    add:
      tracker.boughtGiB + added < 0 ? t("Only {size} was bought", { size: format.gib(tracker.boughtGiB) }) : undefined,
    hours:
      starts && !(Number.isInteger(hours) && hours >= 1 && hours <= MAX_FREELEECH_HOURS)
        ? t("Enter 1 to {max} hours", { max: MAX_FREELEECH_HOURS })
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
  const ratio = format.ratio(ratioOf(tracker));
  const next = errors.add
    ? ratio
    : format.ratio(ratioOf({ uploadedGiB: tracker.uploadedGiB + added, downloadedGiB: tracker.downloadedGiB }));

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
        <Modal.Heading>{t("Change quota · {name}", { name: tracker.name })}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {rich(t, "Bought so far {size}", { size: <Value>{format.gib(tracker.boughtGiB)}</Value> })}
            </p>
            <PointDecimals>
              <NumberField
                variant={FIELD_VARIANT}
                value={add}
                onChange={setAdd}
                step={1}
                formatOptions={GIB_FORMAT}
                isInvalid={errors.add !== undefined}
              >
                <Label>{t("Add upload (GiB)")}</Label>
                <NumberField.Group>
                  <NumberField.DecrementButton />
                  <NumberField.Input placeholder="0" />
                  <NumberField.IncrementButton />
                </NumberField.Group>
                <FieldError>{errors.add}</FieldError>
              </NumberField>
            </PointDecimals>
            <p className="text-sm text-muted">
              {next === ratio
                ? rich(t, "Ratio {ratio}", { ratio: <Value>{ratio}</Value> })
                : rich(t, "Ratio {ratio} → {next}", { ratio: <Value>{ratio}</Value>, next: <Value>{next}</Value> })}
            </p>
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

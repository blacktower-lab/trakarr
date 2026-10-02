import { Button, Description, FieldError, InputGroup, Label, ListBox, Select, Switch, TextField } from "@heroui/react";
import { Check, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { cx } from "../lib/cx";

// HeroUI's dialog examples give their fields the secondary variant, which fills
// them so they show on the dialog's surface. Fields on a card get it too.
export const FIELD_VARIANT = "secondary";

// Two equal columns shared by form rows. They follow the form's width, not the
// screen's, because dialogs are narrower than most screens.
export const ROW = "grid grid-cols-1 items-start gap-x-3 gap-y-4 @md:grid-cols-2";

// A labeled single select over a fixed set of options.
export function SelectField({
  label,
  value,
  onValueChange,
  items,
  isDisabled,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: Record<string, string>;
  isDisabled?: boolean;
}) {
  return (
    <Select
      variant={FIELD_VARIANT}
      value={value}
      onChange={(key) => key !== null && onValueChange(String(key))}
      isDisabled={isDisabled}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {Object.entries(items).map(([key, text]) => (
            <ListBox.Item key={key} id={key} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

interface SwitchFieldProps {
  label: string;
  description: string;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
}

// A switch with its label and description beside it, at the row's end.
export function SwitchField({ label, description, isSelected, onChange, isDisabled }: SwitchFieldProps) {
  // The switch sits at the row's end, so its text is beside it and linked by id.
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label id={labelId}>{label}</Label>
        <Description id={descriptionId}>{description}</Description>
      </div>
      <Switch
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        isSelected={isSelected}
        onChange={onChange}
        isDisabled={isDisabled}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}

// A checkbox before its label and description, centered on both. It's built here
// because HeroUI's has a fixed 16px box and no size prop, at the user's request.
// It copies HeroUI's look: the default color off, the accent on. The label wraps
// the box and all the text, so a click on any of it toggles the checkbox.
export function CheckboxField({ label, description, isSelected, onChange, isDisabled }: SwitchFieldProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <label
      className={cx("group flex w-fit items-center gap-3", isDisabled ? "opacity-50" : "cursor-(--cursor-interactive)")}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={isSelected}
        disabled={isDisabled}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={cx(
          "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors duration-200 peer-focus-visible:status-focused motion-reduce:transition-none",
          isSelected ? "bg-accent text-accent-foreground group-hover:bg-accent-hover" : "bg-default",
        )}
      >
        {isSelected && <Check size={14} strokeWidth={3} />}
      </span>
      <span className="flex flex-col gap-0.5 select-none">
        <span id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </span>
        <Description id={descriptionId}>{description}</Description>
      </span>
    </label>
  );
}

interface SecretInputProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  error?: string;
}

// A password field with a button that shows or hides what was typed.
export function SecretInput({ label, placeholder, value, onChange, autoFocus, error }: SecretInputProps) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;

  return (
    <TextField
      variant={FIELD_VARIANT}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      isInvalid={error !== undefined}
    >
      <Label>{label}</Label>
      <InputGroup>
        <InputGroup.Input type={shown ? "text" : "password"} placeholder={placeholder} autoComplete="off" />
        <InputGroup.Suffix>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={shown ? "Hide" : "Show"}
            onPress={() => setShown((s) => !s)}
          >
            <Icon aria-hidden />
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      <FieldError>{error}</FieldError>
    </TextField>
  );
}

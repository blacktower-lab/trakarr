import {
  Button,
  Description,
  FieldError,
  I18nProvider,
  InputGroup,
  Label,
  ListBox,
  Select,
  Switch,
  TextField,
} from "@heroui/react";
import { Check, Eye, EyeOff } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { useT } from "../lib/prefs";

// HeroUI's dialog examples give their fields the secondary variant, which fills
// them so they show on the dialog's surface. Fields on a card get it too.
export const FIELD_VARIANT = "secondary";

// Two equal columns shared by form rows. They follow the form's width, not the
// screen's, because dialogs are narrower than most screens.
export const ROW = "grid grid-cols-1 items-start gap-x-3 gap-y-4 @md:grid-cols-2";

// Wraps a number field that takes decimals, so it's typed and shown with a point
// in every language. In Spanish a point separates thousands, which would read a
// typed 0.9 as 9, and the numbers around the field have points too.
export function PointDecimals({ children }: { children: ReactNode }) {
  return <I18nProvider locale="en-US">{children}</I18nProvider>;
}

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

interface ChoiceProps {
  type: "checkbox" | "radio";
  // Radios of one group share a name, which lets the arrow keys move between them.
  name?: string;
  label: string;
  description: string;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  // What the box shows while selected.
  mark: ReactNode;
}

// A checkbox or a radio before its label and description, centered on both.
// They're built here because HeroUI's have a fixed 16px box and no size prop, at
// the user's request. It copies HeroUI's look: the default color off, the accent
// on. The label wraps the box and all the text, so a click on any of it toggles
// the control.
function Choice({ type, name, label, description, isSelected, onChange, isDisabled, mark }: ChoiceProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <label
      className={cx("group flex w-fit items-center gap-3", isDisabled ? "opacity-50" : "cursor-(--cursor-interactive)")}
    >
      <input
        type={type}
        name={name}
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
        {isSelected && mark}
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

export function CheckboxField(props: SwitchFieldProps) {
  return <Choice type="checkbox" {...props} mark={<Check size={14} strokeWidth={3} />} />;
}

interface RadioFieldProps<T extends string> {
  // Names the group.
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; description: string }[];
}

// Radios that look like the CheckboxField, in the form's two columns. Only the
// mark differs: a small square where the checkbox has a tick.
export function RadioField<T extends string>({ label, value, onChange, options }: RadioFieldProps<T>) {
  const name = useId();

  return (
    <div role="radiogroup" aria-label={label} className={ROW}>
      {options.map((option) => (
        <Choice
          key={option.id}
          type="radio"
          name={name}
          label={option.label}
          description={option.description}
          isSelected={option.id === value}
          onChange={() => onChange(option.id)}
          mark={<span className="size-2 rounded-xs bg-current" />}
        />
      ))}
    </div>
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
  const t = useT();
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
            aria-label={shown ? t("Hide") : t("Show")}
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

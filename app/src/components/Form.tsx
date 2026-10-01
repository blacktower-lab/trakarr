import { Button, Description, InputGroup, Label, ListBox, Select, Switch, TextField } from "@heroui/react";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

// Every form sits in a dialog, and HeroUI's dialog examples give their fields
// the secondary variant, which fills them so they show on the dialog's surface.
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

// A switch at the row's end, with its label and description beside it.
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

interface SecretInputProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

// A password field with a button that shows or hides what was typed.
export function SecretInput({ label, placeholder, value, onChange, autoFocus }: SecretInputProps) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;

  return (
    <TextField variant={FIELD_VARIANT} value={value} onChange={onChange} autoFocus={autoFocus}>
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
    </TextField>
  );
}

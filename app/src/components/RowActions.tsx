import { Button, Dropdown, Label } from "@heroui/react";
import { Ellipsis, type LucideIcon } from "lucide-react";

export interface RowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
}

interface RowActionsProps {
  // Names the menu's button, since it only shows an icon.
  label: string;
  items: RowAction[];
  onAction: (id: string) => void;
}

// A table row's menu of actions.
export function RowActions({ label, items, onAction }: RowActionsProps) {
  return (
    <Dropdown>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label}>
        <Ellipsis aria-hidden />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu onAction={(key) => onAction(String(key))}>
          {items.map(({ id, label: text, icon: Icon, danger }) => (
            <Dropdown.Item key={id} id={id} textValue={text} variant={danger ? "danger" : "default"}>
              <Icon aria-hidden size={16} />
              <Label>{text}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

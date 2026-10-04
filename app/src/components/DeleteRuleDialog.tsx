import { AlertDialog, Button } from "@heroui/react";
import type { Rule } from "../lib/data";
import { useT } from "../lib/prefs";

interface DeleteRuleDialogProps {
  open: boolean;
  // The rule asked about. It stays set while the dialog animates closed.
  rule: Rule | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (rule: Rule) => void;
}

// The question before a rule is deleted, from the rules page and from the editor.
export function DeleteRuleDialog({ open, rule, onOpenChange, onConfirm }: DeleteRuleDialogProps) {
  const t = useT();
  return (
    <AlertDialog.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Heading>{t("Delete {name}?", { name: rule?.name ?? "" })}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{t("Any downloads it holds are released.")}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="secondary">
              {t("Cancel")}
            </Button>
            <Button slot="close" variant="danger" onPress={() => rule && onConfirm(rule)}>
              {t("Delete")}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}

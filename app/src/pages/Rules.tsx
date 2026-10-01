import { AlertDialog, Button, Table } from "@heroui/react";
import { Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Listed } from "../components/Empty";
import { RowActions, type RowAction } from "../components/RowActions";
import { ACTIONS } from "../components/RuleEditor";
import { Section } from "../components/Section";
import { formatRatio, type Rule } from "../lib/data";

const ACTION_ITEMS: RowAction[] = [
  { id: "edit", label: "Edit rule", icon: Pencil },
  { id: "delete", label: "Delete rule", icon: Trash2, danger: true },
];

interface RulesProps {
  // Undefined until the first poll ends.
  rules: Rule[] | undefined;
  error: Error | undefined;
  onNew: () => void;
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}

export function Rules({ rules, error, onNew, onEdit, onDelete }: RulesProps) {
  // The rule being deleted stays set while the dialog animates closed.
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [confirming, setConfirming] = useState(false);

  const ask = (rule: Rule) => {
    setDeleting(rule);
    setConfirming(true);
  };

  return (
    <>
      <Section
        title="Rules"
        action={
          <Button variant="ghost" size="sm" onPress={onNew}>
            New rule
          </Button>
        }
      >
        <Listed
          loaded={rules !== undefined}
          error={error}
          count={rules?.length ?? 0}
          icon={SlidersHorizontal}
          empty={{ title: "No rules yet", description: "Add a rule to watch a tracker's ratio" }}
        >
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Rules">
                <Table.Header>
                  <Table.Column isRowHeader>Rule</Table.Column>
                  <Table.Column>Matches</Table.Column>
                  <Table.Column>Hold below</Table.Column>
                  <Table.Column>Release above</Table.Column>
                  <Table.Column>When held</Table.Column>
                  <Table.Column textValue="Actions">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {(rules ?? []).map((rule) => (
                    <Table.Row key={rule.id} id={rule.id}>
                      <Table.Cell>
                        <span className="inline-flex items-center gap-2.5">
                          <span className="font-medium">{rule.name}</span>
                          {!rule.enabled && <span className="text-muted">paused</span>}
                        </span>
                      </Table.Cell>
                      <Table.Cell>{[...rule.tags, ...rule.domains].join(", ")}</Table.Cell>
                      <Table.Cell>{formatRatio(rule.holdBelow)}</Table.Cell>
                      <Table.Cell>{formatRatio(rule.releaseAbove)}</Table.Cell>
                      <Table.Cell>{ACTIONS[rule.action].label}</Table.Cell>
                      <Table.Cell>
                        <RowActions
                          label={`Actions for ${rule.name}`}
                          items={ACTION_ITEMS}
                          onAction={(id) => (id === "edit" ? onEdit(rule) : ask(rule))}
                        />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Listed>
      </Section>

      <AlertDialog.Backdrop isOpen={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>Delete {deleting?.name}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>Any downloads it holds are released.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary">
                Cancel
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && onDelete(deleting)}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

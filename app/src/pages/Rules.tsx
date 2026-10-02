import { AlertDialog, Button, Table } from "@heroui/react";
import { Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Listed } from "../components/Empty";
import { RowActions, type RowAction } from "../components/RowActions";
import { ACTIONS } from "../components/RuleEditor";
import { Section } from "../components/Section";
import { thresholdsOf, type Rule } from "../lib/data";
import { useFormat, useT } from "../lib/prefs";

interface RulesProps {
  // Undefined until the first poll ends.
  rules: Rule[] | undefined;
  error: Error | undefined;
  onNew: () => void;
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}

export function Rules({ rules, error, onNew, onEdit, onDelete }: RulesProps) {
  const t = useT();
  const format = useFormat();
  const actionItems: RowAction[] = [
    { id: "edit", label: t("Edit rule"), icon: Pencil },
    { id: "delete", label: t("Delete rule"), icon: Trash2, danger: true },
  ];
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
        title={t("Rules")}
        action={
          <Button variant="ghost" size="sm" onPress={onNew}>
            {t("New rule")}
          </Button>
        }
      >
        <Listed
          loaded={rules !== undefined}
          error={error}
          count={rules?.length ?? 0}
          icon={SlidersHorizontal}
          empty={{ title: t("No rules yet"), description: t("Add a rule to watch a tracker's ratio") }}
        >
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={t("Rules")}>
                <Table.Header>
                  <Table.Column isRowHeader>{t("Rule")}</Table.Column>
                  <Table.Column>{t("Matches")}</Table.Column>
                  <Table.Column>{t("Hold below")}</Table.Column>
                  <Table.Column>{t("Release above")}</Table.Column>
                  <Table.Column>{t("When held")}</Table.Column>
                  <Table.Column textValue={t("Actions")}>
                    <span className="sr-only">{t("Actions")}</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {(rules ?? []).map((rule) => (
                    <Table.Row key={rule.id} id={rule.id}>
                      <Table.Cell>
                        <span className="inline-flex items-center gap-2.5">
                          <span className="font-medium">{rule.name}</span>
                          {rule.byBuffer && <span className="text-muted">{t("buffer")}</span>}
                          {!rule.enabled && <span className="text-muted">{t("paused")}</span>}
                        </span>
                      </Table.Cell>
                      <Table.Cell>{rule.domains.join(", ")}</Table.Cell>
                      <Table.Cell>{format.ratio(thresholdsOf(rule).holdBelow)}</Table.Cell>
                      <Table.Cell>{format.ratio(thresholdsOf(rule).releaseAbove)}</Table.Cell>
                      <Table.Cell>{t(ACTIONS[rule.action].label)}</Table.Cell>
                      <Table.Cell>
                        <RowActions
                          label={t("Actions for {name}", { name: rule.name })}
                          items={actionItems}
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
              <AlertDialog.Heading>{t("Delete {name}?", { name: deleting?.name ?? "" })}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{t("Any downloads it holds are released.")}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary">
                {t("Cancel")}
              </Button>
              <Button slot="close" variant="danger" onPress={() => deleting && onDelete(deleting)}>
                {t("Delete")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

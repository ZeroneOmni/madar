import { Undo2Icon } from "lucide-react";
import { IconAction } from "../WorkspacePage";
import { useLocale } from "../../useLocale";

export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLocale();
  return (
    <IconAction
      size="icon-micro"
      label={t("Reset {name} to default", { name: label })}
      onClick={onClick}
    >
      <Undo2Icon className="size-3" />
    </IconAction>
  );
}

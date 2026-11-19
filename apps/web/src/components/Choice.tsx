import type { ComponentProps } from "react";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "./ui/select";
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size,
  variant,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  size?: ComponentProps<typeof SelectTrigger>["size"];
  variant?: ComponentProps<typeof SelectTrigger>["variant"];
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} size={size} variant={variant}>
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? label}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

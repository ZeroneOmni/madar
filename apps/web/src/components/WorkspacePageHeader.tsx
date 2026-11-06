import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";

export function WorkspacePageHeader({
  electron = false,
  className,
  ...props
}: ComponentPropsWithoutRef<"header"> & {
  readonly electron?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)]! shrink-0 items-center gap-3 pl-(--shell-header-left) pr-(--shell-header-right)",
        electron && "drag-region",
        className,
      )}
      {...props}
    />
  );
}

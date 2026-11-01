import type { ToastManagerAddOptions } from "@base-ui/react/toast";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import type { AppToastData } from "./toast";

export type StackedAppToastOptions = {
  type: "error" | "warning" | "success" | "info" | "loading";
  title: ReactNode;
  description?: ReactNode;
  timeout?: number;
  priority?: "low" | "high";
  actionProps?: ComponentPropsWithoutRef<"button">;
  actionVariant?: AppToastData["actionVariant"];
  data?: Omit<AppToastData, "actionLayout">;
};

export function stackedAppToast(
  options: StackedAppToastOptions,
): ToastManagerAddOptions<AppToastData> {
  const { type, title, description, timeout, priority, actionProps, actionVariant, data } = options;

  const mergedData: AppToastData = {
    ...(data !== undefined ? data : {}),
    actionLayout: "stacked-end",
  };
  if (actionVariant !== undefined) {
    mergedData.actionVariant = actionVariant;
  }

  const payload: ToastManagerAddOptions<AppToastData> = {
    type,
    title,
    data: mergedData,
  };

  if (description !== undefined) {
    payload.description = description;
  }
  if (timeout !== undefined) {
    payload.timeout = timeout;
  }
  if (priority !== undefined) {
    payload.priority = priority;
  }
  if (actionProps !== undefined) {
    payload.actionProps = actionProps;
  }

  return payload;
}

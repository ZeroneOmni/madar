import type { DesktopNotificationInput, DesktopNotificationResult } from "@madar/contracts";

interface NotificationDeliveryDependencies {
  supported: () => boolean;
  focused: () => boolean;
  create: (input: DesktopNotificationInput) => {
    once: {
      (event: "show", listener: () => void): unknown;
      (event: "failed", listener: () => void): unknown;
      (event: "click", listener: () => void): unknown;
    };
    show: () => void;
  };
  activate: (path: string) => void;
}

export function deliverNotification(
  input: DesktopNotificationInput,
  dependencies: NotificationDeliveryDependencies,
): Promise<DesktopNotificationResult> {
  if (!dependencies.supported()) return Promise.resolve({ status: "unsupported" });
  if (dependencies.focused()) return Promise.resolve({ status: "suppressed" });
  return new Promise((resolve) => {
    try {
      const notification = dependencies.create(input);
      notification.once("show", () => resolve({ status: "shown" }));
      notification.once("failed", () =>
        resolve({
          status: "failed",
          message: "The operating system could not display this notification.",
        }),
      );
      notification.once("click", () => dependencies.activate(input.path));
      notification.show();
    } catch {
      resolve({ status: "failed", message: "Desktop notification delivery failed." });
    }
  });
}

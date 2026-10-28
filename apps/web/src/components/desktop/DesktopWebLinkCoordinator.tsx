import { useEffect, useEffectEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { promptLinkAppPath } from "@t3tools/shared/promptLinks";
import { ensureLocalApi } from "../../localApi";
export function DesktopWebLinkCoordinator() {
  const router = useRouter();
  const links = window.desktopBridge?.webLinks;
  const receive = useEffectEvent(async (url: string) => {
    const path = promptLinkAppPath(url);
    if (path !== null)
      await router.navigate({
        href: path,
      });
    else await ensureLocalApi().shell.openExternal(url);
  });
  useEffect(() => {
    if (!links) return;
    const unsubscribe = links.onOpen((url) => {
      void receive(url).catch(() => undefined);
    });
    void links.setReady(true);
    return () => {
      void links.setReady(false);
      unsubscribe();
    };
  }, [links]);
  return null;
}

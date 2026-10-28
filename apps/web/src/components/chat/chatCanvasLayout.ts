export interface CanvasSize {
  width: number;
  height: number;
}
export interface CanvasFrame extends CanvasSize {
  x: number;
  y: number;
}
export interface CanvasDetailsCard {
  left: number;
  right: number;
  bottom: number;
}
export const DETAILS_CARD_CLEARANCE = 32;
export function resolveChatCanvasLayout({
  container,
  padding = 48,
  maxChatWidth = 768,
  detailsCard = null,
}: {
  container: CanvasSize;
  padding?: number;
  maxChatWidth?: number;
  minChatWidth?: number;
  composerHeight?: number;
  detailsCard?: CanvasDetailsCard | null;
  findBar?: CanvasDetailsCard | null;
}) {
  const centeredWidth = Math.max(0, Math.min(maxChatWidth, container.width - padding * 2));
  const laneRight = detailsCard
    ? detailsCard.left - DETAILS_CARD_CLEARANCE
    : container.width - padding;
  const width = Math.max(0, Math.min(centeredWidth, laneRight - padding));
  const left = Math.max(padding, Math.min((container.width - width) / 2, laneRight - width));
  return {
    chat: {
      left,
      width,
      insetStart: 0,
      insetEnd: Math.max(0, container.width - left * 2 - width),
    },
  };
}

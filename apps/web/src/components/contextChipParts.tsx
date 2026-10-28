import { CircleDashedIcon, FilmIcon, ImageIcon } from "lucide-react";
import { useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";

import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { middleTruncateAttachmentName } from "./composerInlineChip";
import { ContextChip, ContextChipLabel, type ContextChipKind } from "./ContextChip";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ContextChipShell({
  icon,
  label,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "className" | "render"> & {
  icon: ReactNode;
  label: string;
  tooltip?: ReactNode;
}) {
  const chip = (
    <ContextChip
      data-context-unresolved={props.state === "unresolved" ? "true" : undefined}
      tabIndex={tooltip ? 0 : undefined}
      {...props}
    >
      {icon}
      <ContextChipLabel>{label}</ContextChipLabel>
    </ContextChip>
  );
  if (!tooltip) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="whitespace-pre-wrap">
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
export function ContextChipPopover(props: {
  kind: ContextChipKind;
  icon: ReactNode;
  label: string;
  copyMarkdown?: string;
  accessibleLabel: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ContextChip
            kind={props.kind}
            render={<button type="button" />}
            aria-label={`${props.accessibleLabel}. Show details`}
            data-markdown-copy={props.copyMarkdown}
          />
        }
      >
        {props.icon}
        <ContextChipLabel>{props.label}</ContextChipLabel>
      </PopoverTrigger>
      <PopoverPopup side="top" width="lg" padding="compact">
        <PopoverTitle className="sr-only">{props.accessibleLabel}</PopoverTitle>
        {props.children}
      </PopoverPopup>
    </Popover>
  );
}
function averageImageColor(image: HTMLImageElement): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let index = 0; index < data.length; index += 4) {
      const weight = data[index + 3]!;
      red += data[index]! * weight;
      green += data[index + 1]! * weight;
      blue += data[index + 2]! * weight;
      alpha += weight;
    }
    if (alpha === 0) return;
    return `rgb(${Math.round(red / alpha)} ${Math.round(green / alpha)} ${Math.round(blue / alpha)})`;
  } catch {
    return;
  }
}
export function ImageChipButton({
  name,
  previewUrl,
  size,
  suffix,
  style,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render"> & {
  name: string;
  previewUrl: string | undefined;
  size: string;
  suffix?: string | null;
}) {
  const [sample, setSample] = useState<{
    url: string;
    color: string | undefined;
  }>();
  const [corsFailedUrl, setCorsFailedUrl] = useState<string>();
  const accent = sample?.url === previewUrl ? sample?.color : undefined;
  return (
    <ContextChip
      kind="image"
      render={<button type="button" />}
      aria-label={`Image attachment, ${name}, ${size}`}
      style={
        {
          ...style,
          ...(accent
            ? {
                "--context-chip-accent": accent,
              }
            : {}),
        } as CSSProperties
      }
      {...props}
    >
      {previewUrl ? (
        <img
          key={previewUrl}
          crossOrigin={corsFailedUrl === previewUrl ? undefined : "anonymous"}
          src={previewUrl}
          alt=""
          className="size-[1.17em] shrink-0 rounded-sm object-cover"
          onError={() => setCorsFailedUrl(previewUrl)}
          onLoad={(event) =>
            setSample({
              url: previewUrl,
              color: averageImageColor(event.currentTarget),
            })
          }
        />
      ) : (
        <ImageIcon />
      )}
      <ContextChipLabel className="flex items-baseline gap-[0.33em]">
        <span className="max-w-72 truncate">{middleTruncateAttachmentName(name)}</span>
        <span className="shrink-0 text-3xs text-current">{size}</span>
        {suffix ? <span className="text-3xs text-current">{suffix}</span> : null}
      </ContextChipLabel>
    </ContextChip>
  );
}
export function FileChip(props: {
  name: string;
  size: string;
  isVideo: boolean;
  theme: "light" | "dark";
  accessibleLabel: string;
  tooltip: string;
  suffix?: string | null;
  copyMarkdown?: string;
  disabled?: boolean;
  error?: boolean;
  unresolved?: boolean;
  onOpen?: (() => void) | undefined;
}) {
  const content = <FileChipContent {...props} />;
  const state = props.unresolved
    ? ("unresolved" as const)
    : props.error
      ? ("invalid" as const)
      : null;
  const attributes = {
    kind: props.isVideo ? "video" : "file",
    ...(state
      ? {
          state,
        }
      : {}),
    "aria-label": [props.accessibleLabel, props.suffix].filter(Boolean).join(", "),
    "data-markdown-copy": props.copyMarkdown,
    "data-context-unresolved": props.unresolved ? "true" : undefined,
  } as const;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          props.onOpen ? (
            <ContextChip
              render={<button type="button" disabled={props.disabled} />}
              onClick={props.onOpen}
              {...attributes}
            >
              {content}
            </ContextChip>
          ) : (
            <ContextChip tabIndex={0} {...attributes}>
              {content}
            </ContextChip>
          )
        }
      />
      <TooltipPopup side="top" className="whitespace-pre-wrap">
        {props.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
function FileChipContent(props: {
  name: string;
  size: string;
  isVideo: boolean;
  theme: "light" | "dark";
  suffix?: string | null;
}) {
  return (
    <>
      {props.isVideo ? (
        <FilmIcon />
      ) : (
        <PierreEntryIcon pathValue={props.name} kind="file" theme={props.theme} />
      )}
      <ContextChipLabel className="flex items-baseline gap-[0.33em]">
        <span className="max-w-72 truncate">{middleTruncateAttachmentName(props.name)}</span>
        <span className="shrink-0 text-3xs text-current">{props.size}</span>
        {props.suffix ? <span className="text-3xs text-current">{props.suffix}</span> : null}
      </ContextChipLabel>
    </>
  );
}
export function UnresolvedChip(props: { label: string; tooltip: string; copyMarkdown?: string }) {
  return (
    <ContextChipShell
      icon={<CircleDashedIcon />}
      label={props.label}
      state="unresolved"
      aria-label={`Unavailable context, ${props.label}`}
      data-markdown-copy={props.copyMarkdown}
      tooltip={props.tooltip}
    />
  );
}

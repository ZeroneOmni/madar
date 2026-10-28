import type { ComposerImageAttachment } from "../../composerDraftStore";

export function groupComposerImages(
  composerImages: ReadonlyArray<ComposerImageAttachment>,
  composerPreviewAnnotations: ReadonlyArray<{
    readonly id: string;
  }>,
) {
  const previewAnnotationIds = new Set(
    composerPreviewAnnotations.map((annotation) => annotation.id),
  );
  return {
    standaloneComposerImages: composerImages.filter((image) => !previewAnnotationIds.has(image.id)),
  };
}

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
] as const;

export const DESKTOP_RENDERER_ORIGINS = ["madar://app", "madar-dev://app"] as const;

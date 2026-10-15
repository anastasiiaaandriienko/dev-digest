/** Full timestamp in the row tooltip (next-intl `format.dateTime`, app locale); the row shows `versionWhen`. */
export const WHEN_FORMAT = {
  dateStyle: "medium",
  timeStyle: "short",
} as const satisfies Intl.DateTimeFormatOptions;

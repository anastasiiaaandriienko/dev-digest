/** How a version's timestamp is shown (next-intl `format.dateTime`, app locale). */
export const WHEN_FORMAT = {
  dateStyle: "medium",
  timeStyle: "short",
} as const satisfies Intl.DateTimeFormatOptions;

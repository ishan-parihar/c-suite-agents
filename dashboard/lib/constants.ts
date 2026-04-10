export const Z_INDEX = {
  dropdown: 10,
  sticky: 20,
  overlay: 30,
  modal: 40,
  sidebar: 50,
  toast: 100,
  command: 200,
} as const;

export const STATUS_MAP = {
  healthy: { color: "var(--status-healthy)", label: "Healthy" },
  warning: { color: "var(--status-warning)", label: "Warning" },
  critical: { color: "var(--status-critical)", label: "Critical" },
  neutral: { color: "var(--status-neutral)", label: "Inactive" },
} as const;

export type StatusKey = keyof typeof STATUS_MAP;

export const PAGINATION_SIZES = [10, 25, 50, 100] as const;

export const DATE_FORMATS = {
  date: "yyyy-MM-dd",
  datetime: "yyyy-MM-dd HH:mm",
  time: "HH:mm",
  relative: "PP",
} as const;

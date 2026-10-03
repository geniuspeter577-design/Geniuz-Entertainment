const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

function formatMessage(label: string, ...parts: unknown[]) {
  return `[${label}] ${parts.map((part) => String(part)).join(' ')}`;
}

export const logger = {
  info: (label: string, ...parts: unknown[]) => {
    if (isDev) {
      console.info(formatMessage(label, ...parts));
    }
  },
  warn: (label: string, ...parts: unknown[]) => {
    if (isDev) {
      console.warn(formatMessage(label, ...parts));
    }
  },
  error: (label: string, ...parts: unknown[]) => {
    if (isDev) {
      console.error(formatMessage(label, ...parts));
    }
  },
};

export type ConversionStatus = 'uploaded' | 'converting' | 'ready' | 'failed';
export type ConversionStatusColor = 'green' | 'grey' | 'yellow' | 'red';

export type ConversionStatusBadge = {
  status: ConversionStatus;
  label: string;
  color: ConversionStatusColor;
};

const STATUS_BADGES: Record<ConversionStatus, ConversionStatusBadge> = {
  uploaded: { status: 'uploaded', label: 'Uploaded', color: 'grey' },
  converting: { status: 'converting', label: 'Converting', color: 'yellow' },
  ready: { status: 'ready', label: 'Ready', color: 'green' },
  failed: { status: 'failed', label: 'Failed', color: 'red' },
};

export function getConversionStatusBadge(value: unknown): ConversionStatusBadge {
  if (typeof value === 'string' && value in STATUS_BADGES) {
    return STATUS_BADGES[value as ConversionStatus];
  }
  return STATUS_BADGES.ready;
}
export function formatMembershipDate(value: string | undefined) {
  if (!value) {
    return 'Unavailable';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}
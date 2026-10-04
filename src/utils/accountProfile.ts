export type ProfileCreationInput = {
  userId: string;
  displayName: string | null | undefined;
  publicId: string;
};

export function isValidProfileCreation(input: ProfileCreationInput) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.userId) &&
    Boolean(input.displayName?.trim()) &&
    (input.displayName?.trim().length ?? 0) <= 80 &&
    /^\d{8}$/.test(input.publicId)
  );
}

export function normalizeUsername(username: string) {
  return username.trim().replace(/^@+/, '').toLocaleLowerCase();
}

export function isValidUsername(username: string) {
  return /^[a-z][a-z0-9_]{2,23}$/.test(normalizeUsername(username));
}

export function getUsernameError(username: string) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return 'Choose a username.';
  }
  if (!isValidUsername(normalized)) {
    return 'Use 3–24 lowercase letters, numbers, or underscores; start with a letter.';
  }
  return undefined;
}

export function isValidDateOfBirth(dateOfBirth: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return false;
  }
  const parsed = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === dateOfBirth &&
    dateOfBirth >= '1900-01-01' &&
    dateOfBirth <= today
  );
}

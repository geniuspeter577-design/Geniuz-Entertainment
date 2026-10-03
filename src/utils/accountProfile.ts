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

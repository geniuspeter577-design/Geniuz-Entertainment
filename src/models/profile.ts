export type AccountProfile = {
  id: string;
  display_name: string;
  avatar_color: string;
  public_id: string;
  created_at: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
};

export function isAccountProfile(value: unknown, userId?: string): value is AccountProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === 'string' &&
    (!userId || profile.id === userId) &&
    typeof profile.display_name === 'string' &&
    typeof profile.avatar_color === 'string' &&
    typeof profile.public_id === 'string' &&
    /^\d{8}$/.test(profile.public_id) &&
    typeof profile.created_at === 'string' &&
    (typeof profile.username === 'string' || profile.username === null) &&
    (typeof profile.bio === 'string' || profile.bio === null) &&
    (typeof profile.avatar_url === 'string' || profile.avatar_url === null)
  );
}

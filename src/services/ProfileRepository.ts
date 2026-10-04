import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountProfile } from '../models/profile';
import { isAccountProfile } from '../models/profile';
import { normalizeUsername, isValidUsername } from '../utils/accountProfile';
import { isValidDateOfBirth } from '../utils/accountProfile';

const PROFILE_COLUMNS = 'id,display_name,avatar_color,public_id,created_at,username,bio,avatar_url,date_of_birth';

export type AccountProfileUpdate = {
  display_name: string;
  username: string;
  bio: string;
  avatar_url: string | null;
};

export class ProfileRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getForUser(userId: string): Promise<AccountProfile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data === null) {
      return null;
    }
    if (!isAccountProfile(data, userId)) {
      throw new Error('The account profile response was invalid.');
    }
    return data;
  }

  async updateDisplayName(userId: string, displayName: string): Promise<AccountProfile> {
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new Error('Display name must be between 1 and 80 characters.');
    }
    return this.updateProfile(userId, {
      display_name: normalizedName,
    });
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const normalizedUsername = username.trim().toLocaleLowerCase();
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(normalizedUsername)) {
      return false;
    }
    const { data, error } = await this.client.rpc('is_username_available', {
      requested_username: normalizedUsername,
    });
    if (error) {
      throw new Error('Username availability could not be checked. Try again.', { cause: error });
    }
    return data === true;
  }

  async updateProfile(userId: string, update: Partial<AccountProfileUpdate>): Promise<AccountProfile> {
    const normalizedUpdate = { ...update };
    if (typeof update.username === 'string') {
      const username = normalizeUsername(update.username);
      if (!isValidUsername(username)) {
        throw new Error('Use 3–24 lowercase letters, numbers, or underscores; start with a letter.');
      }
      normalizedUpdate.username = username;
    }
    if (typeof update.bio === 'string' && update.bio.length > 160) {
      throw new Error('Bio must be 160 characters or fewer.');
    }
    if (typeof update.display_name === 'string') {
      const displayName = update.display_name.trim();
      if (!displayName || displayName.length > 80) {
        throw new Error('Display name must be between 1 and 80 characters.');
      }
      normalizedUpdate.display_name = displayName;
    }
    const { data, error } = await this.client
      .from('profiles')
      .update(normalizedUpdate)
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!isAccountProfile(data, userId)) {
      throw new Error('The account profile could not be updated.');
    }
    return data;
  }

  async completeDateOfBirth(dateOfBirth: string): Promise<void> {
    if (!isValidDateOfBirth(dateOfBirth)) {
      throw new Error('Enter a valid date of birth in YYYY-MM-DD format.');
    }
    const { error } = await this.client.rpc('complete_profile_date_of_birth', {
      requested_date: dateOfBirth,
    });
    if (error) {
      throw new Error('Your date of birth could not be saved. Please retry.', { cause: error });
    }
  }

  async requestAccountDeletion(userId: string, reason: string): Promise<void> {
    const { error } = await this.client.from('account_deletion_requests').insert({
      user_id: userId,
      reason: reason.trim() || null,
    });
    if (error) {
      throw new Error('Your account deletion request could not be sent. Please try again.', {
        cause: error,
      });
    }
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountProfile } from '../models/profile';
import { isAccountProfile } from '../models/profile';

export class ProfileRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getForUser(userId: string): Promise<AccountProfile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id,display_name,avatar_color,public_id,created_at')
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
    const { data, error } = await this.client
      .from('profiles')
      .update({ display_name: normalizedName })
      .eq('id', userId)
      .select('id,display_name,avatar_color,public_id,created_at')
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!isAccountProfile(data, userId)) {
      throw new Error('The account profile could not be updated.');
    }
    return data;
  }
}

import { router } from 'expo-router';
import { File as ExpoFile } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { KeyboardAwareScrollView, KeyboardAwareTextInput } from '../src/components/KeyboardAwareScrollView';
import { useAuth } from '../src/state/AuthContext';
import { supabase } from '../src/services/supabase';
import { ProfileRepository } from '../src/services/ProfileRepository';
import { theme } from '../src/theme';
import { getProfileInitial } from '../src/utils/accountAuth';
import { getUsernameError, normalizeUsername } from '../src/utils/accountProfile';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export default function EditProfileScreen() {
  const auth = useAuth();
  const [displayName, setDisplayName] = useState(auth.profile?.display_name ?? '');
  const [username, setUsername] = useState(auth.profile?.username ?? '');
  const [bio, setBio] = useState(auth.profile?.bio ?? '');
  const [avatarPreview, setAvatarPreview] = useState(auth.profile?.avatar_url ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<string>();
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const [isPasswordBusy, setIsPasswordBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  const [isDeletionBusy, setIsDeletionBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const repository = supabase ? new ProfileRepository(supabase) : null;
  const initializedProfileId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!auth.profile || initializedProfileId.current === auth.profile.id) {
      return;
    }
    initializedProfileId.current = auth.profile.id;
    setDisplayName(auth.profile.display_name);
    setUsername(auth.profile.username ?? '');
    setBio(auth.profile.bio ?? '');
    setAvatarPreview(auth.profile.avatar_url);
  }, [auth.profile]);

  const checkUsername = async () => {
    const validation = getUsernameError(username);
    if (validation) {
      setUsernameStatus(validation);
      return false;
    }
    if (!repository) {
      setUsernameStatus('Account service is not configured.');
      return false;
    }
    setIsCheckingUsername(true);
    setUsernameStatus(undefined);
    try {
      const available = await repository.isUsernameAvailable(normalizeUsername(username));
      setUsernameStatus(available ? 'Username is available.' : 'That username is already taken.');
      return available;
    } catch (checkError) {
      setUsernameStatus(checkError instanceof Error ? checkError.message : 'Username availability could not be checked.');
      return false;
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const saveProfile = async () => {
    setError(undefined);
    setMessage(undefined);
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 80) {
      setError('Display name must be between 1 and 80 characters.');
      return;
    }
    const usernameError = getUsernameError(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (bio.length > 160) {
      setError('Bio must be 160 characters or fewer.');
      return;
    }
    if (!auth.session || !repository) {
      setError('Sign in to update your profile.');
      return;
    }
    setIsSaving(true);
    try {
      const available = await repository.isUsernameAvailable(normalizeUsername(username));
      if (!available) {
        throw new Error('That username is already taken. Choose another one.');
      }
      await auth.updateProfile({
        display_name: normalizedName,
        username: normalizeUsername(username),
        bio: bio.trim(),
      });
      setMessage('Profile saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Profile could not be saved. Please retry.');
    } finally {
      setIsSaving(false);
    }
  };

  const pickAvatar = async () => {
    if (!auth.session || !repository || !supabase) {
      setError('Sign in to change your profile picture.');
      return;
    }
    setIsAvatarBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      const side = Math.min(asset.width, asset.height);
      const processed = await ImageManipulator.ImageManipulator.manipulate(asset.uri)
        .crop({
          originX: Math.round((asset.width - side) / 2),
          originY: Math.round((asset.height - side) / 2),
          width: side,
          height: side,
        })
        .resize({ width: 512, height: 512 })
        .renderAsync();
      let saved = await processed.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.75 });
      if (new ExpoFile(saved.uri).size > AVATAR_MAX_BYTES) {
        const smaller = await ImageManipulator.ImageManipulator.manipulate(asset.uri)
          .crop({
            originX: Math.round((asset.width - side) / 2),
            originY: Math.round((asset.height - side) / 2),
            width: side,
            height: side,
          })
          .resize({ width: 512, height: 512 })
          .renderAsync();
        saved = await smaller.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.55 });
      }
      const imageFile = new ExpoFile(saved.uri);
      if (imageFile.size > AVATAR_MAX_BYTES) {
        throw new Error('This picture could not be compressed below 2 MB. Choose a different image.');
      }
      const objectPath = `${auth.session.user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(
        objectPath,
        await imageFile.bytes(),
        { contentType: 'image/jpeg', cacheControl: '3600', upsert: true },
      );
      if (uploadError) {
        throw new Error('The profile picture could not be uploaded. Please retry.', { cause: uploadError });
      }
      const publicUrl = `${supabase.storage.from('avatars').getPublicUrl(objectPath).data.publicUrl}?v=${Date.now()}`;
      await auth.updateProfile({ avatar_url: publicUrl });
      setAvatarPreview(publicUrl);
      setMessage('Profile picture updated.');
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'The profile picture could not be updated.');
    } finally {
      setIsAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (!auth.session || !repository || !supabase) {
      return;
    }
    setIsAvatarBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await auth.updateProfile({ avatar_url: null });
      setAvatarPreview(null);
      const { error: removeError } = await supabase.storage.from('avatars').remove([
        `${auth.session.user.id}/avatar.jpg`,
      ]);
      if (removeError) {
        throw new Error('Your picture was removed from the profile, but its stored file could not be deleted.', {
          cause: removeError,
        });
      }
      setMessage('Profile picture removed.');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'The profile picture could not be removed.');
    } finally {
      setIsAvatarBusy(false);
    }
  };

  const changePassword = async () => {
    setError(undefined);
    setMessage(undefined);
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!supabase) {
      setError('Account service is not configured.');
      return;
    }
    setIsPasswordBusy(true);
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) {
        throw passwordError;
      }
      setPassword('');
      setConfirmPassword('');
      setMessage('Password updated.');
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : 'Password could not be updated. Please retry.');
    } finally {
      setIsPasswordBusy(false);
    }
  };

  const submitDeletionRequest = async () => {
    if (!auth.session || !repository) {
      setError('Sign in to request account deletion.');
      return;
    }
    setIsDeletionBusy(true);
    setError(undefined);
    try {
      await repository.requestAccountDeletion(auth.session.user.id, deletionReason);
      setMessage('Your account deletion request was recorded. Our team will follow up.');
      setDeletionReason('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Your request could not be sent. Please retry.');
    } finally {
      setIsDeletionBusy(false);
    }
  };

  const confirmDeletionRequest = () => {
    Alert.alert(
      'Request account deletion?',
      'This records a request for our team. Your account will not be deleted automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send request', style: 'destructive', onPress: () => void submitDeletionRequest() },
      ],
    );
  };

  if (!auth.session || !auth.profile || auth.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.messageState}>
          <ContentNotice
            message={
              !auth.session
                ? 'Sign in to edit your profile.'
                : auth.isLoading
                  ? 'Loading your profile…'
                  : auth.profileError ?? 'Your profile could not be loaded.'
            }
            tone={auth.profileError ? 'error' : 'info'}
          />
          {auth.session && !auth.profile && !auth.isLoading ? (
            <Pressable accessibilityRole="button" onPress={() => void auth.refreshProfile()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.linkText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Edit profile</Text>
        {error ? <ContentNotice message={error} tone="error" /> : null}
        {message ? <ContentNotice message={message} /> : null}
        <View style={styles.section}>
          <View style={styles.avatarRow}>
            {avatarPreview ? (
              <Image source={{ uri: avatarPreview }} style={styles.avatar} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{getProfileInitial(displayName, auth.session.user.email)}</Text>
              </View>
            )}
            <View style={styles.avatarActions}>
              <Pressable accessibilityRole="button" disabled={isAvatarBusy} onPress={() => void pickAvatar()} style={styles.secondaryButton}>
                {isAvatarBusy ? <ActivityIndicator color={theme.accent} /> : <Text style={styles.secondaryButtonText}>Choose picture</Text>}
              </Pressable>
              {avatarPreview ? (
                <Pressable accessibilityRole="button" disabled={isAvatarBusy} onPress={() => void removeAvatar()} style={styles.textButton}>
                  <Text style={styles.linkText}>Remove picture</Text>
                </Pressable>
              ) : null}
              <Text style={styles.helper}>Square JPEG, 512 px, maximum 2 MB.</Text>
            </View>
          </View>
          <Text style={styles.label}>Display name</Text>
          <KeyboardAwareTextInput
            accessibilityLabel="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={80}
            autoCapitalize="words"
            placeholder="Display name"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
          />
          <Text style={styles.label}>Username</Text>
          <KeyboardAwareTextInput
            accessibilityLabel="Username"
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setUsernameStatus(undefined);
            }}
            onBlur={() => void checkUsername()}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={25}
            placeholder="your_username"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
          />
          {isCheckingUsername ? <Text style={styles.helper}>Checking username…</Text> : null}
          {usernameStatus ? <Text style={styles.helper}>{usernameStatus}</Text> : null}
          <Text style={styles.label}>Bio</Text>
          <KeyboardAwareTextInput
            accessibilityLabel="Bio"
            value={bio}
            onChangeText={setBio}
            maxLength={160}
            multiline
            textAlignVertical="top"
            placeholder="Tell people a little about yourself"
            placeholderTextColor={theme.secondaryText}
            style={[styles.input, styles.bioInput]}
          />
          <Text style={styles.counter}>{bio.length}/160</Text>
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => void saveProfile()} style={[styles.primaryButton, isSaving && styles.disabled]}>
            <Text style={styles.primaryButtonText}>{isSaving ? 'Saving…' : 'Save profile'}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change password</Text>
          <Text style={styles.helper}>Use at least 8 characters.</Text>
          <KeyboardAwareTextInput
            accessibilityLabel="New password"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            placeholder="New password"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
          />
          <KeyboardAwareTextInput
            accessibilityLabel="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            placeholder="Confirm new password"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
          />
          <Pressable accessibilityRole="button" disabled={isPasswordBusy || !password} onPress={() => void changePassword()} style={[styles.primaryButton, isPasswordBusy && styles.disabled]}>
            <Text style={styles.primaryButtonText}>{isPasswordBusy ? 'Updating…' : 'Update password'}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            void auth.signOut().then(() => router.replace('/(tabs)/profile')).catch((signOutError: unknown) => {
              setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out. Please retry.');
            });
          }} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Log out</Text>
          </Pressable>
          <Text style={styles.label}>Delete my account</Text>
          <Text style={styles.helper}>
            Send a deletion request to our team. This does not delete your account immediately.
          </Text>
          <KeyboardAwareTextInput
            accessibilityLabel="Account deletion request details"
            value={deletionReason}
            onChangeText={setDeletionReason}
            maxLength={500}
            multiline
            textAlignVertical="top"
            placeholder="Optional details"
            placeholderTextColor={theme.secondaryText}
            style={[styles.input, styles.bioInput]}
          />
          <Pressable accessibilityRole="button" disabled={isDeletionBusy} onPress={confirmDeletionRequest} style={[styles.deleteButton, isDeletionBusy && styles.disabled]}>
            <Text style={styles.deleteText}>{isDeletionBusy ? 'Sending…' : 'Request account deletion'}</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { gap: 16, padding: 18, paddingBottom: 40 },
  messageState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
  backButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8 },
  title: { color: theme.text, fontSize: 25, fontWeight: '800' },
  section: { gap: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
  sectionTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: theme.background, fontSize: 26, fontWeight: '800' },
  avatarActions: { flex: 1, alignItems: 'flex-start', gap: 6 },
  label: { color: theme.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, color: theme.text, paddingHorizontal: 14 },
  bioInput: { minHeight: 92, paddingTop: 12 },
  helper: { color: theme.secondaryText, fontSize: 12, lineHeight: 17 },
  counter: { alignSelf: 'flex-end', color: theme.secondaryText, fontSize: 12 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.accent, marginTop: 4 },
  primaryButtonText: { color: theme.background, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  secondaryButtonText: { color: theme.text, fontWeight: '700' },
  textButton: { minHeight: 36, justifyContent: 'center' },
  linkText: { color: theme.accent, fontWeight: '700' },
  deleteButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: theme.error },
  deleteText: { color: theme.error, fontWeight: '800' },
});

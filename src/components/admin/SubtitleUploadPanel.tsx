import { File as ExpoFile } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ContentItem, EpisodeItem } from '../../models/content';
import { supabaseMovieRepository } from '../../repositories/SupabaseMovieRepository';
import { theme } from '../../theme';
import { readFilePart } from '../../utils/readFilePart';
import { validateSubtitleFile, type SubtitleFormat } from '../../utils/subtitles';

type SelectedSubtitleFile = {
  file: File | ExpoFile;
  name: string;
  size: number;
  format: SubtitleFormat;
};

type Props = {
  titles: readonly ContentItem[];
  isOnline: boolean;
};

export function SubtitleUploadPanel({ titles, isOnline }: Props) {
  const [targetKind, setTargetKind] = useState<'movie' | 'episode'>('movie');
  const [selectedTitleId, setSelectedTitleId] = useState('');
  const [titleSearch, setTitleSearch] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [episodeSearch, setEpisodeSearch] = useState('');
  const [episodeData, setEpisodeData] = useState<{
    seriesId: string;
    retryAttempt: number;
    episodes: EpisodeItem[];
    error?: string;
  }>();
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [episodeLoadRetry, setEpisodeLoadRetry] = useState(0);
  const [selectedFile, setSelectedFile] = useState<SelectedSubtitleFile>();
  const [languageLabel, setLanguageLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const titleChoices = useMemo(
    () => titles.filter((title) => title.type === 'movie' || title.type === 'short'),
    [titles],
  );
  const seriesChoices = useMemo(
    () => titles.filter((title) => title.type === 'series'),
    [titles],
  );
  const episodeDataIsCurrent =
    episodeData?.seriesId === selectedSeriesId &&
    episodeData.retryAttempt === episodeLoadRetry;
  const episodes = episodeDataIsCurrent ? episodeData.episodes : [];
  const episodesLoading = Boolean(
    selectedSeriesId && isOnline && supabaseMovieRepository && !episodeDataIsCurrent,
  );
  const episodesError = !selectedSeriesId
    ? undefined
    : !isOnline
      ? 'Connect to the internet to load episodes.'
      : !supabaseMovieRepository
        ? 'Episode service is not configured.'
        : episodeDataIsCurrent
          ? episodeData.error
          : undefined;
  const filteredTitles = titleChoices.filter((title) =>
    title.title.toLocaleLowerCase().includes(titleSearch.trim().toLocaleLowerCase()),
  );
  const filteredEpisodes = episodes.filter((episode) =>
    episode.title.toLocaleLowerCase().includes(episodeSearch.trim().toLocaleLowerCase()),
  );
  const selectedTitle = titleChoices.find((title) => title.id === selectedTitleId);
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId);

  useEffect(() => {
    if (!selectedSeriesId || !isOnline || !supabaseMovieRepository) {
      return;
    }
    let active = true;
    void supabaseMovieRepository
      .getSeasons(selectedSeriesId)
      .then((seasons) => {
        if (active) {
          setEpisodeData({
            seriesId: selectedSeriesId,
            retryAttempt: episodeLoadRetry,
            episodes: seasons.flatMap((season) => season.episodes),
          });
        }
      })
      .catch((loadError: unknown) => {
        console.error('[SubtitleUploadPanel] Could not load series episodes.', loadError);
        if (active) {
          setEpisodeData({
            seriesId: selectedSeriesId,
            retryAttempt: episodeLoadRetry,
            episodes: [],
            error: 'Episodes could not be loaded. Check your connection and retry.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [episodeLoadRetry, isOnline, selectedSeriesId]);

  const chooseFile = async () => {
    setError(undefined);
    setSuccess(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/vtt', 'application/x-subrip', 'text/plain'],
        copyToCacheDirectory: false,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      const file = asset.file ?? new ExpoFile(asset.uri);
      const size = typeof file.size === 'number' ? file.size : Number.NaN;
      const validation = validateSubtitleFile(asset.name, size);
      if (!validation.valid) {
        setError(validation.message);
        setSelectedFile(undefined);
        return;
      }
      setSelectedFile({
        file,
        name: asset.name,
        size,
        format: validation.format,
      });
    } catch (pickerError) {
      console.error('[SubtitleUploadPanel] Subtitle picker failed.', pickerError);
      setError('Could not open the subtitle picker. Please try again.');
    }
  };

  const upload = async () => {
    if (!isOnline) {
      setError('Connect to the internet before uploading subtitles.');
      return;
    }
    if (!supabaseMovieRepository) {
      setError('Subtitle storage is not configured.');
      return;
    }
    const target = targetKind === 'movie' ? selectedTitle : selectedEpisode;
    if (!target) {
      setError(targetKind === 'movie' ? 'Choose a title first.' : 'Choose an episode first.');
      return;
    }
    const label = languageLabel.trim();
    if (!label || label.length > 64) {
      setError('Enter a subtitle language label up to 64 characters.');
      return;
    }
    if (!selectedFile) {
      setError('Choose an .srt or .vtt subtitle file first.');
      return;
    }

    setUploading(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const contentType =
        selectedFile.format === 'vtt' ? 'text/vtt' : 'application/x-subrip';
      const blob = await readFilePart(
        selectedFile.file,
        0,
        selectedFile.size,
        contentType,
      );
      if (blob.size !== selectedFile.size) {
        throw new Error('The selected subtitle file could not be read completely.');
      }
      await supabaseMovieRepository.uploadSubtitleTrack({
        contentKind: targetKind,
        contentId: target.id.replace(/^geniuz:(?:movie|short|episode):/, ''),
        languageLabel: label,
        format: selectedFile.format,
        blob,
      });
      setSelectedFile(undefined);
      setSuccess(`Subtitle uploaded for ${target.title}.`);
    } catch (uploadError) {
      console.error('[SubtitleUploadPanel] Subtitle upload failed.', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : 'The subtitle could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Upload subtitles</Text>
      <Text style={styles.helper}>
        Subtitle files are private. Signed links are available only for published titles and episodes.
      </Text>
      <View style={styles.toggleRow}>
        {(['movie', 'episode'] as const).map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityState={{ selected: targetKind === kind }}
            disabled={uploading}
            onPress={() => setTargetKind(kind)}
            style={[styles.toggle, targetKind === kind && styles.toggleSelected]}
          >
            <Text style={[styles.toggleText, targetKind === kind && styles.toggleTextSelected]}>
              {kind === 'movie' ? 'Title' : 'Episode'}
            </Text>
          </Pressable>
        ))}
      </View>

      {targetKind === 'movie' ? (
        <>
          <TextInput
            accessibilityLabel="Search titles for subtitles"
            value={titleSearch}
            onChangeText={setTitleSearch}
            placeholder="Search titles"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
          />
          <ScrollView nestedScrollEnabled style={styles.choiceList}>
            {filteredTitles.map((title) => (
              <Pressable
                key={title.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedTitleId === title.id }}
                onPress={() => setSelectedTitleId(title.id)}
                style={[styles.choice, selectedTitleId === title.id && styles.choiceSelected]}
              >
                <Text style={[styles.choiceText, selectedTitleId === title.id && styles.choiceTextSelected]}>
                  {title.title}
                </Text>
              </Pressable>
            ))}
            {!filteredTitles.length ? <Text style={styles.helper}>No matching titles.</Text> : null}
          </ScrollView>
        </>
      ) : (
        <>
          <Text style={styles.label}>Series</Text>
          <ScrollView nestedScrollEnabled style={styles.choiceList}>
            {seriesChoices.map((series) => (
              <Pressable
                key={series.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedSeriesId === series.id }}
                onPress={() => {
                  setSelectedSeriesId(series.id);
                  setEpisodeSearch('');
                }}
                style={[styles.choice, selectedSeriesId === series.id && styles.choiceSelected]}
              >
                <Text style={[styles.choiceText, selectedSeriesId === series.id && styles.choiceTextSelected]}>
                  {series.title}
                </Text>
              </Pressable>
            ))}
            {!seriesChoices.length ? <Text style={styles.helper}>Create a series first.</Text> : null}
          </ScrollView>
          {selectedSeriesId ? (
            <>
              <Text style={styles.label}>Episode</Text>
              <TextInput
                accessibilityLabel="Search episodes for subtitles"
                value={episodeSearch}
                onChangeText={setEpisodeSearch}
                placeholder="Search episodes"
                placeholderTextColor={theme.secondaryText}
                style={styles.input}
              />
              {episodesLoading ? <Text style={styles.helper}>Loading episodes…</Text> : null}
              {episodesError ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEpisodeLoadRetry((attempt) => attempt + 1)}
                >
                  <Text style={styles.error}>{episodesError} Retry</Text>
                </Pressable>
              ) : null}
              <ScrollView nestedScrollEnabled style={styles.choiceList}>
                {filteredEpisodes.map((episode) => (
                  <Pressable
                    key={episode.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedEpisodeId === episode.id }}
                    onPress={() => setSelectedEpisodeId(episode.id)}
                    style={[styles.choice, selectedEpisodeId === episode.id && styles.choiceSelected]}
                  >
                    <Text style={[styles.choiceText, selectedEpisodeId === episode.id && styles.choiceTextSelected]}>
                      S{episode.seasonNumber ?? 1} E{episode.episodeNumber} · {episode.title}
                    </Text>
                  </Pressable>
                ))}
                {!episodesLoading && !episodesError && !filteredEpisodes.length ? (
                  <Text style={styles.helper}>No episodes are available.</Text>
                ) : null}
              </ScrollView>
            </>
          ) : null}
        </>
      )}

      <TextInput
        accessibilityLabel="Subtitle language label"
        value={languageLabel}
        onChangeText={setLanguageLabel}
        placeholder="Language label, e.g. English"
        placeholderTextColor={theme.secondaryText}
        maxLength={64}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        disabled={uploading}
        onPress={() => void chooseFile()}
        style={styles.fileButton}
      >
        <Text style={styles.choiceText}>
          {selectedFile ? `${selectedFile.name} · ${selectedFile.size} bytes` : 'Choose .srt or .vtt file'}
        </Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={uploading || !isOnline}
        onPress={() => void upload()}
        style={[styles.submitButton, (uploading || !isOnline) && styles.disabled]}
      >
        <Text style={styles.submitText}>{uploading ? 'Uploading subtitle…' : 'Upload subtitle'}</Text>
      </Pressable>
      {!isOnline ? <Text style={styles.error}>Connect to the internet to upload subtitles.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    marginBottom: 16,
    padding: 16,
  },
  title: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  helper: {
    color: theme.secondaryText,
    fontSize: 12,
    lineHeight: 18,
  },
  label: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggle: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  toggleSelected: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  toggleText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
  },
  toggleTextSelected: {
    color: theme.background,
  },
  input: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 11,
    borderWidth: 1,
    color: theme.text,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  choiceList: {
    gap: 6,
    maxHeight: 190,
  },
  choice: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceSelected: {
    borderColor: theme.accent,
  },
  choiceText: {
    color: theme.text,
    fontSize: 13,
  },
  choiceTextSelected: {
    color: theme.accent,
    fontWeight: '700',
  },
  fileButton: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 11,
    borderWidth: 1,
    padding: 13,
  },
  error: {
    color: theme.error,
    fontSize: 12,
  },
  success: {
    color: theme.accent,
    fontSize: 12,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
  },
  submitText: {
    color: theme.background,
    fontSize: 13,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.5,
  },
});

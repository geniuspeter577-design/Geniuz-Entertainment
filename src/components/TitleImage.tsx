import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';

import { theme } from '../theme';

export function TitleImage({
  uri,
  style,
  iconSize = 36,
}: {
  uri?: string;
  style: StyleProp<ImageStyle>;
  iconSize?: number;
}) {
  const [failedUri, setFailedUri] = useState<string>();
  const [loadedUri, setLoadedUri] = useState<string>();
  const showImage = Boolean(uri && uri !== failedUri);

  return (
    <View style={[styles.placeholder, style]}>
      {showImage ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={() => setLoadedUri(uri)}
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <Ionicons name="film-outline" size={iconSize} color={theme.secondaryText} />
      )}
      {showImage && loadedUri !== uri && failedUri !== uri ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    overflow: 'hidden',
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
  },
});

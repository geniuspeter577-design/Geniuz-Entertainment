import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { theme } from '../theme';

type Props = { count: number; token?: number; direction?: 'up' | 'down' };

export function FootballGoalBalls({ count, token, direction = 'up' }: Props) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (count <= 0) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [count, progress, token]);

  if (count <= 0) {
    return null;
  }
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, direction === 'up' ? -34 : 34] });
  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View pointerEvents="none" style={[styles.balls, direction === 'down' && styles.ballsDown]}>
      {Array.from({ length: Math.min(count, 5) }, (_, index) => (
        <Animated.View
          key={`${token ?? 0}-${index}`}
          style={[
            styles.ball,
            { opacity, transform: [{ translateY }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }], left: index * 15 },
          ]}
        >
          <Ionicons name="football" size={16} color={theme.accent} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  balls: { height: 20, left: 0, position: 'absolute', top: 0, width: 90, zIndex: 5 },
  ballsDown: { top: 'auto', bottom: 0 },
  ball: { alignItems: 'center', position: 'absolute', width: 17 },
});

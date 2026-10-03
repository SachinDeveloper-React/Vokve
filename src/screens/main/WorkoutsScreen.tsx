import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WorkoutCard } from '../../components/fitness/WorkoutCard';
import { AppText } from '../../components/ui/AppText';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useWorkoutTemplates } from '../../hooks/useWorkouts';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { RootStackParamList } from '../../types/navigation';
import type { WorkoutTemplate } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    header: { paddingTop: spacing.sm, paddingBottom: spacing.base },
    separator: { height: spacing.md },
    listContent: { paddingBottom: spacing.xxxl },
  });

/**
 * The routine library — the server's (`GET /workout-templates`), so a new
 * routine needs no release. Not reachable from a tab yet.
 */
export const WorkoutsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const templates = useWorkoutTemplates();

  // Stable identities: without useCallback every row's memo() would be
  // defeated on each render of this screen.
  const handleSelect = useCallback(
    (template: WorkoutTemplate) =>
      navigation.navigate('WorkoutDetail', { template }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: WorkoutTemplate }) => (
      <WorkoutCard template={item} onPress={handleSelect} />
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback((item: WorkoutTemplate) => item.id, []);

  const separator = useCallback(
    () => <View style={styles.separator} />,
    [styles.separator],
  );

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <AppText variant="h1">Workouts</AppText>
        <AppText variant="body" color="textSecondary">
          Pick a routine or build your own.
        </AppText>
      </View>

      {/*
        FlashList recycles row views instead of keeping every one mounted,
        which is what keeps scrolling smooth once the library grows past a
        screenful.
      */}
      {templates.data ? (
        <FlashList
          data={templates.data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={separator}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <LoadState
          loading={templates.loading}
          title="Couldn't load the workouts"
          message={templates.error}
          onRetry={templates.reload}
        />
      )}
    </Screen>
  );
};

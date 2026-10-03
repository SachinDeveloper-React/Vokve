import { seedVitals } from '../../src/constants/seedData';
import { useVitalsStore } from '../../src/stores/vitalsStore';

/**
 * The vitals as a finished sync leaves them: the seeded readings as the
 * server's, and the seeded BMI as the one it derived.
 */
export const stockVitals = () =>
  useVitalsStore.setState({
    readings: seedVitals
      .filter(reading => reading.kind !== 'bmi')
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    bmi: seedVitals.find(reading => reading.kind === 'bmi') ?? null,
    outbox: [],
    syncedAt: new Date().toISOString(),
    isSyncing: false,
    syncError: null,
  });

import { challengeApi } from '../services/api/endpoints';
import type { Achievement, Challenge } from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/** The challenge board for one day (`GET /challenges?date=`). */
export function useChallengeBoard(date: string): Loaded<Challenge[]> {
  return useServerRead(`challenges:${date}`, () => challengeApi.board(date));
}

/** The achievement shelf (`GET /achievements`). */
export function useAchievements(): Loaded<Achievement[]> {
  return useServerRead('achievements', () => challengeApi.achievements());
}

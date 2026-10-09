import { challengeApi } from '../services/api/endpoints';
import type {
  Achievement,
  AchievementDetail,
  Challenge,
  ChallengeDetail,
} from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/** The challenge board for one day (`GET /challenges?date=`). */
export function useChallengeBoard(date: string): Loaded<Challenge[]> {
  return useServerRead(`challenges:${date}`, () => challengeApi.board(date));
}

/**
 * One challenge in full for a day (`GET /challenges/:id?date=`).
 *
 * Keyed on both, so opening a second challenge asks for that one rather than
 * repainting the first one's figures under its title while the answer lands.
 */
export function useChallengeDetail(
  id: string,
  date: string,
): Loaded<ChallengeDetail> {
  return useServerRead(`challenge:${id}:${date}`, () =>
    challengeApi.detail(id, date),
  );
}

/** The achievement shelf (`GET /achievements`). */
export function useAchievements(): Loaded<Achievement[]> {
  return useServerRead('achievements', () => challengeApi.achievements());
}

/** One badge in full (`GET /achievements/:id`). */
export function useAchievementDetail(id: string): Loaded<AchievementDetail> {
  return useServerRead(`achievement:${id}`, () => challengeApi.achievement(id));
}

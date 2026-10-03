import { leaderboardApi } from '../services/api/endpoints';
import type {
  LeaderboardBoard,
  LeaderboardHistory,
  LeaderboardRules,
} from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/** This week's board for the user's country (`GET /leaderboard`). */
export function useLeaderboardBoard(): Loaded<LeaderboardBoard> {
  return useServerRead('leaderboard:board', () => leaderboardApi.board());
}

/** The user's record over closed weeks (`GET /leaderboard/history`). */
export function useLeaderboardHistory(): Loaded<LeaderboardHistory> {
  return useServerRead('leaderboard:history', () => leaderboardApi.history());
}

/** The prizes and the rules (`GET /leaderboard/reward-tiers`). */
export function useLeaderboardRules(): Loaded<LeaderboardRules> {
  return useServerRead('leaderboard:rules', () => leaderboardApi.rules());
}

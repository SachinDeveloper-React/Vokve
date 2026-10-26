import { leaderboardApi } from '../services/api/endpoints';
import type {
  LeaderboardBoard,
  LeaderboardHistory,
  LeaderboardRules,
} from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/**
 * This week's board for the user's country (`GET /leaderboard`), a page at a
 * time.
 *
 * `places` is how many of the board to ask for — the card under the prize
 * table wants five and took fifty before this, and the full-board screen
 * grows it as the reader asks for more. The server clips it to the board's
 * own size (⚙ `leaderboard.boardSize`), so a screen cannot ask past the last
 * place it holds; `hasMore` on the answer says whether there is another page.
 *
 * Keyed by the number asked for, so each page size is its own cache entry
 * rather than one that flickers between sizes as two screens share it.
 */
export function useLeaderboardBoard(places?: number): Loaded<LeaderboardBoard> {
  return useServerRead(
    places === undefined ? 'leaderboard:board' : `leaderboard:board:${places}`,
    () =>
      leaderboardApi.board(
        places === undefined ? undefined : { limit: places },
      ),
  );
}

/** The user's record over closed weeks (`GET /leaderboard/history`). */
export function useLeaderboardHistory(): Loaded<LeaderboardHistory> {
  return useServerRead('leaderboard:history', () => leaderboardApi.history());
}

/** The prizes and the rules (`GET /leaderboard/reward-tiers`). */
export function useLeaderboardRules(): Loaded<LeaderboardRules> {
  return useServerRead('leaderboard:rules', () => leaderboardApi.rules());
}

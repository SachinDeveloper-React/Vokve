import { contentApi } from '../services/api/endpoints';
import type {
  ContentTip,
  ContentTopic,
  ReferralCard,
  ReferralScreen,
} from '../types/models';
import { todayIso } from '../utils/date';
import { useServerRead } from './useServerRead';

/**
 * The day's tip for one place in the app (`GET /content/tips/:topic`), or
 * null while it is on its way or could not be had — a tip is never worth a
 * spinner or an error, so a card waiting for one simply is not drawn.
 */
export function useTip(topic: ContentTopic): ContentTip | null {
  return useServerRead(`tip:${topic}:${todayIso()}`, () =>
    contentApi.tip(topic),
  ).data;
}

/**
 * This screen's invite card (`GET /content/referral-cards`), or null where
 * the operator has not put one here — in which case nothing is drawn.
 *
 * Every screen reads the same answer under the same key, so the ten screens
 * that can carry a card share one request and one cached copy: the key is
 * the day, not the screen. Like a tip, a promo is never worth a spinner or
 * an error message, so a card still on its way is simply absent.
 */
export function useReferralCard(screen: ReferralScreen): ReferralCard | null {
  const { data } = useServerRead(`referral-cards:${todayIso()}`, () =>
    contentApi.referralCards(),
  );
  return data?.cards[screen] ?? null;
}

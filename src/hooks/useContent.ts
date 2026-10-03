import { contentApi } from '../services/api/endpoints';
import type { ContentTip, ContentTopic } from '../types/models';
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

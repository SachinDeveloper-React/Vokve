import { contentTipSchema, type ContentTip } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { localDayOf } from '../../lib/dates.js';
import { ContentTipModel } from './models.js';

/**
 * The day's tip for one place in the app: the same one all day, the next
 * one tomorrow, round the topic's active tips in order. Chosen by the
 * caller's own day so the tip changes at their midnight.
 */
export async function tipOfTheDay(topic: string, timeZone: string, now = new Date()): Promise<ContentTip> {
  const tips = await ContentTipModel.find({ topic, active: true }).sort({ sort: 1, _id: 1 }).lean();
  if (tips.length === 0) throw Errors.notFound('A tip');
  const dayNumber = Math.floor(Date.parse(`${localDayOf(now, timeZone)}T00:00:00Z`) / 86_400_000);
  const tip = tips[dayNumber % tips.length];
  return contentTipSchema.parse({ id: tip._id, topic: tip.topic, title: tip.title ?? null, text: tip.text });
}

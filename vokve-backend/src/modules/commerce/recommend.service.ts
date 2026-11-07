import { getConfig } from '../../config/remote.js';
import { CoinBalanceModel } from '../economy/models.js';
import { OrderModel, ShopItemModel, WishlistModel } from './models.js';

/**
 * What the shop puts in front of one member, and why (RULES R19).
 *
 * Rules rather than a model, for the same reason the food suggestions are:
 * a collaborative recommender needs thousands of baskets before it says
 * anything but noise, and a shop this size does not have them yet. What it
 * does have is enough — what this member has bought, what they have saved,
 * and what they can actually pay for today.
 *
 * The last of those is the one that matters most and is easiest to get
 * wrong. A shelf of things somebody cannot afford is not a recommendation,
 * it is a list of disappointments, and a coin-priced shop makes that
 * failure particular: the member can see the exact number they are short
 * by. So affordability is a *sort*, never a filter — the things they can
 * have come first, and the rest are still reachable, because hiding them
 * would be deciding on their behalf that they will never save up.
 */

export interface ShopSuggestion {
  itemId: string;
  title: string;
  emoji: string | null;
  imageUrl: string | null;
  price: number;
  coinPrice: number;
  category: string;
  /** Whether today's coin balance covers it outright. */
  affordable: boolean;
  /** One line, in the member's own terms. */
  reason: string;
}

interface ItemRow {
  _id: string;
  title: string;
  emoji?: string | null;
  imageUrl?: string | null;
  images?: string[];
  price: number;
  coinPrice?: number | null;
  category: string;
  isDeal?: boolean;
  featured?: boolean;
  active?: boolean;
}

export async function suggestShopItems(userId: string): Promise<{ data: ShopSuggestion[] }> {
  const config = await getConfig();
  const rules = config.commerce.recommend;

  const [orders, saved, wallet] = await Promise.all([
    // Only what they actually bought. A basket abandoned at checkout says
    // something, but not something good enough to shape a shelf with.
    OrderModel.find({ userId }, { items: 1 }).sort({ createdAt: -1 }).limit(rules.ordersRead).lean(),
    WishlistModel.find({ userId }, { itemId: 1 }).lean<{ itemId: string }[]>(),
    CoinBalanceModel.findById(userId, { balanceMc: 1 }).lean<{ balanceMc?: number } | null>(),
  ]);

  const coins = Math.floor((wallet?.balanceMc ?? 0) / 1000);
  const savedIds = new Set(saved.map(row => row.itemId));
  const bought = new Set<string>();
  const categoryWeight = new Map<string, number>();

  for (const order of orders) {
    for (const line of (order.items ?? []) as { itemId: string }[]) {
      bought.add(line.itemId);
    }
  }

  // What shelves they buy from, counted from the items themselves rather
  // than the order lines: a line keeps the title it was bought under, not
  // the category, and a product can be recategorised afterwards.
  if (bought.size > 0) {
    const boughtItems = await ShopItemModel.find(
      { _id: { $in: [...bought] } },
      { category: 1 },
    ).lean<{ _id: string; category: string }[]>();
    for (const item of boughtItems) {
      categoryWeight.set(item.category, (categoryWeight.get(item.category) ?? 0) + 1);
    }
  }

  const candidates = await ShopItemModel.find(
    {
      active: { $ne: false },
      // Never what they already own or have already saved: a shelf that
      // recommends the bottle they bought last week is a shelf that has
      // not been paying attention.
      _id: { $nin: [...bought, ...savedIds] },
    },
    {
      title: 1, emoji: 1, imageUrl: 1, images: 1, price: 1,
      coinPrice: 1, category: 1, isDeal: 1, featured: 1,
    },
  )
    .limit(rules.scanLimit)
    .lean<ItemRow[]>();

  const scored = candidates
    .map(item => {
      const coinPrice = item.coinPrice ?? Math.ceil(item.price / config.commerce.coinValuePaise);
      const affordable = coins >= coinPrice && coinPrice > 0;
      const affinity = categoryWeight.get(item.category) ?? 0;

      let score = 0;
      let reason = 'Picked for you';
      // Ordered so the *strongest* true statement becomes the reason, and
      // so the reason is always one the member could verify themselves.
      if (affinity > 0) {
        score += rules.categoryWeight * affinity;
        reason = `You have bought from ${item.category} before`;
      }
      if (affordable) {
        score += rules.affordableWeight;
        if (affinity === 0) reason = `Your coins cover this`;
      }
      if (item.isDeal) {
        score += rules.dealWeight;
        if (affinity === 0 && !affordable) reason = 'On offer right now';
      }
      if (item.featured) score += rules.featuredWeight;

      return {
        suggestion: {
          itemId: item._id,
          title: item.title,
          emoji: item.emoji ?? null,
          imageUrl: item.imageUrl ?? item.images?.[0] ?? null,
          price: item.price,
          coinPrice,
          category: item.category,
          affordable,
          reason,
        },
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, rules.limit);

  return { data: scored.map(row => row.suggestion) };
}

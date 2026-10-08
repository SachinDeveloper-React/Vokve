import { Schema, model } from 'mongoose';
import { orderStatusSchema, shopBadgeSchema, shopCategorySchema } from '../../contracts/index.js';

export const ORDER_STATUSES = orderStatusSchema.options;

/** The catalogue (ARCHITECTURE §6 commerce). `_id` is the slug the client already keys on. */
const shopItemSchema = new Schema(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    /** Selling price and, when discounted, the list price it is struck against — both paise (RULES R11). */
    price: { type: Number, required: true, min: 1 },
    mrp: { type: Number, default: null },
    category: { type: String, enum: shopCategorySchema.options, required: true },
    emoji: { type: String, default: '🎁' },
    imageUrl: { type: String, default: null },
    badge: { type: String, enum: [...shopBadgeSchema.options, null], default: null },
    isDeal: { type: Boolean, default: false },
    /** `coins` / `money` / `mixed` for this item alone; null follows ⚙ `commerce.paymentMode` (RULES R11). */
    paymentMode: { type: String, default: null },
    featured: { type: Boolean, default: false },
    subcategory: { type: String, default: null },
    tags: { type: [String], default: [] },
    /** The sizes it comes in; empty for one-size. A line records the one chosen. */
    sizes: { type: [String], default: [] },
    /** Likewise the colours, by name; the hex only draws the swatch. */
    colors: { type: [{ _id: false, name: { type: String, required: true }, hex: { type: String, required: true } }], default: [] },
    /** Product photos, the cover first. `imageUrl` is the older single photo and is read as a one-photo gallery. */
    images: { type: [String], default: [] },
    ribbon: { type: String, default: null },
    /** The product page's facts: by the price, under "Key Features", and under "Product Information". */
    highlights: { type: [{ _id: false, icon: String, label: String, value: String }], default: [] },
    features: { type: [{ _id: false, icon: String, title: String, caption: String }], default: [] },
    specs: { type: [{ _id: false, icon: String, label: String, value: String }], default: [] },
    /** What "popular" sorts by: orders placed, bumped by fulfilment; seeded with a starting figure. */
    popularity: { type: Number, default: 0 },
    /** Denormalised from `reviews` on every write, so a list never joins them (RULES R15). */
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    /** When the item first went on sale — "newest" sorts by it, separately from the row's own timestamps. */
    listedAt: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'shop_items' },
);
shopItemSchema.index({ active: 1, category: 1, sort: 1 });
shopItemSchema.index({ active: 1, popularity: -1 });
shopItemSchema.index({ active: 1, price: 1 });
export const ShopItemModel = model('ShopItem', shopItemSchema);

/**
 * The basket, one document per user (RULES R14). Lines are references, not
 * snapshots: a price that changes while something sits in the basket is
 * the new price at checkout, which is what a shopper expects of a basket
 * and the opposite of what they expect of an order.
 */
const cartSchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    lines: [{
      _id: false,
      itemId: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
      size: { type: String, default: null },
      color: { type: String, default: null },
      addedAt: { type: Date, default: Date.now },
    }],
    /** The coupon the member applied (RULES R16), kept while it stops applying so it returns when the basket qualifies. */
    couponCode: { type: String, default: null },
  },
  { timestamps: true, collection: 'carts' },
);
export const CartModel = model('Cart', cartSchema);

/** One row per saved item, keyed so a second save of the same item is a no-op rather than a duplicate. */
const wishlistSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${itemId}`
    userId: { type: String, required: true },
    itemId: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { collection: 'wishlists', versionKey: false },
);
wishlistSchema.index({ userId: 1, addedAt: -1 });
export const WishlistModel = model('Wishlist', wishlistSchema);

/**
 * Reviews (RULES R15): one per user per item — the unique index is the
 * rule — edited in place rather than added to. `verified` is set at write
 * time from the user's orders and never revisited: a review written after
 * buying stays a buyer's review even if the order is later refunded.
 */
const reviewSchema = new Schema(
  {
    _id: { type: String, required: true },
    itemId: { type: String, required: true },
    userId: { type: String, required: true },
    authorName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: null },
    body: { type: String, required: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'reviews' },
);
reviewSchema.index({ itemId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ itemId: 1, createdAt: -1 });
reviewSchema.index({ itemId: 1, rating: -1, createdAt: -1 });
export const ReviewModel = model('Review', reviewSchema);

/**
 * Stock, one row per item. The `min: 0` validator is the last line: the
 * conditional `findOneAndUpdate` in `redeem()` is what actually stops two
 * buyers taking the last unit (RULES R2, R8).
 */
const inventorySchema = new Schema(
  {
    _id: { type: String, required: true },
    onHand: { type: Number, default: 0, min: 0 },
    lowStockAt: { type: Number, default: 5 },
  },
  { timestamps: true, collection: 'shop_inventory' },
);
export const ShopInventoryModel = model('ShopInventory', inventorySchema);

/** The address book (RULES R4). Soft-deleted: an order's snapshot outlives the row. */
const addressSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    label: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, default: 'IN' },
    isDefault: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'addresses' },
);
addressSchema.index({ userId: 1, isDefault: 1 });
export const AddressModel = model('Address', addressSchema);

/** The money side of an order (RULES R12): what the gateway was asked for and where it stands. */
const paymentSchema = new Schema(
  {
    provider: { type: String, default: null },
    /** How the member chose to pay (RULES R12); null on orders from before the payment page. */
    method: { type: String, default: null },
    status: { type: String, default: 'not_required' },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    providerOrderId: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    /** An unpaid order is released after this by the scheduler. */
    expiresAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * An order and its history in one document (ARCHITECTURE §6): the items and
 * the address are snapshots, so a catalogue edit or a deleted address never
 * rewrites what was bought or where it went; `events` is every state change
 * (RULES R5), which is what support reads.
 */
const orderSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** The reference a member reads out — `VKV2609191234`. Display only; `_id` is the key. */
    number: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'placed' },
    currency: { type: String, default: 'INR' },
    /** The till's figures at the time, all paise (RULES R11–R13). */
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    coinsUsed: { type: Number, default: 0, min: 0 },
    coinsValue: { type: Number, default: 0, min: 0 },
    payable: { type: Number, required: true, min: 0 },
    /** `{ code, title, discount }` as it was placed with (RULES R16); null for none. */
    coupon: { type: Schema.Types.Mixed, default: null },
    /** The coin rows of an order placed in a coins-only shop; null otherwise. */
    inCoins: { type: Schema.Types.Mixed, default: null },
    /** `{ instructions, whatsappUpdates, leaveAtDoor }` as the member asked (RULES R17); null on older orders. */
    delivery: { type: Schema.Types.Mixed, default: null },
    payment: { type: paymentSchema, required: true, default: () => ({}) },
    items: [{
      _id: false,
      itemId: { type: String, required: true },
      title: { type: String, required: true },
      emoji: { type: String, default: '🎁' },
      image: { type: String, default: null },
      coinPrice: { type: Number, default: 0 },
      quantity: { type: Number, required: true, min: 1 },
      size: { type: String, default: null },
      color: { type: String, default: null },
      price: { type: Number, required: true, min: 1 },
      mrp: { type: Number, default: null },
      /** What this line was paid with (RULES R11), as the till split it. */
      coinsUsed: { type: Number, default: 0 },
      coinsValue: { type: Number, default: 0 },
      moneyPaid: { type: Number, default: 0 },
    }],
    addressSnapshot: { type: Schema.Types.Mixed, required: true },
    addressId: { type: String, default: null },
    /** `{ from, to }` as promised when it was placed; null on orders from before. */
    estimatedDelivery: { type: Schema.Types.Mixed, default: null },
    placedAt: { type: Date, default: Date.now },
    trackingRef: { type: String, default: null },
    notes: { type: String, default: null },
    events: [{
      _id: false,
      from: { type: String, default: null },
      to: { type: String, required: true },
      actor: { type: String, required: true },
      at: { type: Date, default: Date.now },
    }],
    /** The ledger row that paid the coins part, and the refund row if cancelled. */
    ledgerId: { type: String, default: null },
    refundLedgerId: { type: String, default: null },
  },
  { timestamps: true, collection: 'orders' },
);
orderSchema.index({ userId: 1, placedAt: -1 });
// Support looks an order up by the number a member reads out.
orderSchema.index({ number: 1 });
orderSchema.index({ status: 1, placedAt: -1 });
orderSchema.index({ status: 1, 'payment.expiresAt': 1 });
orderSchema.index({ userId: 1, 'items.itemId': 1 });
export const OrderModel = model('Order', orderSchema);

/**
 * Coupons (RULES R16). `_id` is the code, upper-case. One takes a share of
 * the goods (`percent`, capped at `maxDiscount`) or a fixed sum (`flat`)
 * off an order whose goods reach `minSubtotal`, between its dates, while
 * `redemptions` is under `maxRedemptions` and the member is under
 * `perUserLimit`. Operators write them; the seed only adds a starter pair.
 */
const couponSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** What the member reads: "10% off, up to ₹150". */
    title: { type: String, required: true },
    kind: { type: String, enum: ['percent', 'flat'], required: true },
    /** 1–100 for `percent`; paise for `flat`. */
    value: { type: Number, required: true, min: 1 },
    /** Paise; the most a `percent` coupon takes off. Null for no cap. */
    maxDiscount: { type: Number, default: null },
    /** Paise of goods, at selling price before the coupon, the order must reach. */
    minSubtotal: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    /** Across every member; null for no limit. Counted at checkout, given back on cancel. */
    maxRedemptions: { type: Number, default: null },
    redemptions: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: 1 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'coupons' },
);
export const CouponModel = model('Coupon', couponSchema);

/**
 * How many of one member's orders hold one coupon: `_id` is
 * `${code}:${userId}`. The checkout's conditional `$inc` on this row is
 * what holds the per-member limit when two orders race.
 */
const couponUsageSchema = new Schema(
  {
    _id: { type: String, required: true },
    code: { type: String, required: true },
    userId: { type: String, required: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'coupon_usage' },
);
export const CouponUsageModel = model('CouponUsage', couponUsageSchema);

/**
 * A member's delivery preferences (RULES R17), one row per member: the
 * defaults the shipping page opens with. Each order keeps its own copy, so
 * changing these never rewrites an order already placed.
 */
const deliveryPreferencesSchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    instructions: { type: String, default: '' },
    whatsappUpdates: { type: Boolean, default: false },
    leaveAtDoor: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'delivery_preferences' },
);
export const DeliveryPreferencesModel = model('DeliveryPreferences', deliveryPreferencesSchema);

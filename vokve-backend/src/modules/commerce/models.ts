import { Schema, model } from 'mongoose';
import { orderStatusSchema, shopBadgeSchema, shopCategorySchema } from '../../contracts/index.js';

export const ORDER_STATUSES = orderStatusSchema.options;

/** The catalogue (ARCHITECTURE §6 commerce). `_id` is the slug the client already keys on. */
const shopItemSchema = new Schema(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    priceCoins: { type: Number, required: true, min: 1 },
    category: { type: String, enum: shopCategorySchema.options, required: true },
    emoji: { type: String, default: '🎁' },
    imageUrl: { type: String, default: null },
    badge: { type: String, enum: [...shopBadgeSchema.options, null], default: null },
    isDeal: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'shop_items' },
);
shopItemSchema.index({ active: 1, sort: 1 });
export const ShopItemModel = model('ShopItem', shopItemSchema);

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

/**
 * An order and its history in one document (ARCHITECTURE §6): the items and
 * the address are snapshots, so a catalogue edit or a deleted address never
 * rewrites what was bought or where it went; `events` is every state change
 * (RULES R5), which is what support reads.
 */
const orderSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'placed' },
    totalCoins: { type: Number, required: true, min: 1 },
    items: [{
      _id: false,
      itemId: { type: String, required: true },
      title: { type: String, required: true },
      emoji: { type: String, default: '🎁' },
      quantity: { type: Number, required: true, min: 1 },
      priceCoins: { type: Number, required: true, min: 1 },
    }],
    addressSnapshot: { type: Schema.Types.Mixed, required: true },
    addressId: { type: String, default: null },
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
    /** The ledger row that paid for it, and the refund row if cancelled. */
    ledgerId: { type: String, default: null },
    refundLedgerId: { type: String, default: null },
  },
  { timestamps: true, collection: 'orders' },
);
orderSchema.index({ userId: 1, placedAt: -1 });
orderSchema.index({ status: 1, placedAt: -1 });
export const OrderModel = model('Order', orderSchema);

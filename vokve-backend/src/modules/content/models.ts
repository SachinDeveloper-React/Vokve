import { Schema, model } from 'mongoose';

export const CONTENT_TOPICS = ['motivation', 'hydration', 'reminders', 'nutrition', 'health', 'heart_rate', 'blood_pressure'] as const;

/**
 * The app's standing words — tips, the day's motivation line — kept here so
 * they can be written, rotated and corrected without a release. One is
 * shown per topic per day.
 */
const contentTipSchema = new Schema(
  {
    _id: { type: String, required: true },
    topic: { type: String, enum: CONTENT_TOPICS, required: true },
    title: { type: String, default: null },
    text: { type: String, required: true },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'content_tips', versionKey: false },
);
contentTipSchema.index({ topic: 1, active: 1, sort: 1 });
export const ContentTipModel = model('ContentTip', contentTipSchema);

/**
 * Where a referral card may be drawn.
 *
 * A closed list for the same reason `CONTENT_TOPICS` is one: each entry is a
 * place in a screen that was built to hold the card, so a screen that is not
 * on this list has nowhere to put it and an id that is not on the list would
 * simply never be read. The list is served with the rows so the panel can
 * offer exactly these and nothing else.
 */
export const REFERRAL_SCREENS = [
  'home',
  'wallet',
  'shop',
  'challenges',
  'nutrition',
  'health',
  'hydration',
  'streak',
  'analytics',
  'account',
] as const;
export type ReferralScreen = (typeof REFERRAL_SCREENS)[number];

/** The tints the app can draw the card in. Names, not colours: the app owns the palette. */
export const REFERRAL_ACCENTS = ['brand', 'primary', 'success', 'gold'] as const;

/**
 * Where down a screen the banner sits.
 *
 * Three anchors rather than a free position, because each one is a real gap
 * the screen was built to open: `top` under the screen's own headline,
 * `middle` after its first block of content, `bottom` at the foot of the
 * scroll. A banner always at the foot is a banner nobody scrolls to, and one
 * always at the top is in the way of the figures somebody came for — so
 * which of the three is the operator's call, per screen.
 */
export const REFERRAL_POSITIONS = ['top', 'middle', 'bottom'] as const;

/**
 * The invite card the app shows around the place, written here so its words,
 * its colour and the screens it appears on belong to whoever is running the
 * campaign rather than to a release.
 *
 * One row is one card on one screen. A screen with several active rows
 * rotates them a day at a time, exactly as `content_tips` does, so a
 * campaign can run two lines and see the week out with both.
 *
 * What is deliberately **not** here is the reward. `{coins}` and
 * `{friendCoins}` in the text are filled in by the server from
 * `coins.referral` as it is actually paying — an operator who could type the
 * number would eventually type one the economy does not honour, and the card
 * would be promising coins nobody receives.
 */
const referralPromoSchema = new Schema(
  {
    _id: { type: String, required: true },
    screen: { type: String, enum: REFERRAL_SCREENS, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    /** The button's words. "Invite friends", "Share your code". */
    ctaLabel: { type: String, default: 'Invite friends' },
    accent: { type: String, enum: REFERRAL_ACCENTS, default: 'brand' },
    position: { type: String, enum: REFERRAL_POSITIONS, default: 'bottom' },
    /** One glyph, drawn large beside the words. */
    emoji: { type: String, default: '\ud83c\udf81' },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
    /**
     * `seed` while the card is still the one the app shipped, and the admin
     * who last wrote it after that. It is what `operatorOwned` reads: a
     * re-seed happens on every deploy, and a campaign somebody rewrote must
     * not be quietly reset by one.
     */
    updatedBy: { type: String, default: 'seed' },
  },
  { timestamps: true, collection: 'referral_promos', versionKey: false },
);
referralPromoSchema.index({ screen: 1, active: 1, sort: 1 });
export const ReferralPromoModel = model('ReferralPromo', referralPromoSchema);

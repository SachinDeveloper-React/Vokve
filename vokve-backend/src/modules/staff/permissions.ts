/**
 * What a member of staff may do on the admin surface (RULES Z9).
 *
 * Every admin route names the permission it needs in `ROUTE_PERMISSIONS`
 * below, and `guard.ts` refuses to *register* a route that is not in the
 * table — so a new route cannot ship open by accident: the server does not
 * boot until somebody decides who may call it.
 *
 * The hierarchy is the other half (`effectivePermissions`): an admin holds
 * everything; a manager holds what an admin gave them; an agent holds what
 * their manager gave them **and the manager still holds**. Take a permission
 * off a manager and every agent under them loses it in the same moment.
 */

export const PERMISSION_GROUPS = [
  {
    key: 'watch',
    label: 'Watch',
    permissions: [
      { key: 'analytics.view', label: 'see analytics' },
      { key: 'diagnose.view', label: 'see the fleet diagnosis' },
    ],
  },
  {
    key: 'members',
    label: 'Members',
    permissions: [
      { key: 'members.view', label: 'find members and read their account' },
      { key: 'members.edit', label: "edit a member's profile, contacts and settings" },
      { key: 'members.status', label: 'freeze an account or put it on legal hold' },
      { key: 'members.coins', label: 'credit or claw back coins' },
      { key: 'members.badges', label: 'grant a badge' },
      { key: 'members.notify', label: 'message a member or nudge a sync' },
      { key: 'members.basket', label: "change a member's basket or wishlist" },
      { key: 'members.steps', label: "re-score a day or reject a device's steps" },
    ],
  },
  {
    key: 'fraud',
    label: 'Fraud',
    permissions: [
      { key: 'fraud.view', label: 'read the fraud queue and case files' },
      { key: 'fraud.decide', label: 'confirm or dismiss a fraud flag' },
    ],
  },
  {
    key: 'orders',
    label: 'Orders',
    permissions: [
      { key: 'orders.view', label: 'read the order book' },
      { key: 'orders.update', label: 'move an order on or change its address' },
      { key: 'orders.cancel', label: 'cancel an order' },
      { key: 'orders.refund', label: 'refund an order' },
    ],
  },
  {
    key: 'shop',
    label: 'Shop',
    permissions: [
      { key: 'catalogue.view', label: 'read the catalogue' },
      { key: 'catalogue.edit', label: 'add, edit, import or retire products' },
      { key: 'catalogue.delete', label: 'delete a product for good' },
      { key: 'media.view', label: 'read the image library' },
      { key: 'media.upload', label: 'upload or rename images' },
      { key: 'media.delete', label: 'delete images' },
      { key: 'categories.view', label: 'read the categories' },
      { key: 'categories.edit', label: 'change categories and subcategories' },
      { key: 'coupons.view', label: 'read coupons' },
      { key: 'coupons.edit', label: 'create, edit or switch coupons' },
      { key: 'coupons.delete', label: 'delete a coupon' },
      { key: 'baskets.view', label: 'read open baskets and demand' },
      { key: 'reviews.view', label: 'read product reviews' },
      { key: 'reviews.edit', label: 'edit a review' },
      { key: 'reviews.delete', label: 'delete a review' },
    ],
  },
  {
    key: 'messages',
    label: 'Messages',
    permissions: [
      { key: 'notifications.view', label: 'read sent notifications and consent' },
      { key: 'notifications.broadcast', label: 'broadcast to a segment' },
      { key: 'notifications.retract', label: 'retract a broadcast or delete a notification' },
      { key: 'notifications.automate', label: 'change automated messages and schedule messages' },
    ],
  },
  {
    key: 'fitness',
    label: 'Fitness',
    permissions: [
      { key: 'challenges.view', label: 'read challenges' },
      { key: 'challenges.edit', label: 'create, edit or retire challenges' },
      { key: 'challenges.delete', label: 'delete a challenge for good' },
      { key: 'achievements.view', label: 'read achievements' },
      { key: 'achievements.edit', label: 'create, edit or retire achievements' },
      { key: 'training.view', label: 'read exercises and workout templates' },
      { key: 'training.edit', label: 'change exercises and workout templates' },
      { key: 'leaderboard.view', label: 'read the leaderboard' },
    ],
  },
  {
    key: 'nutrition',
    label: 'Nutrition',
    permissions: [
      { key: 'nutrition.view', label: 'read foods and diet plans' },
      { key: 'nutrition.edit', label: 'add, edit, import or retire foods and diet plans' },
      { key: 'nutrition.delete', label: 'delete foods or diet plans for good' },
    ],
  },
  {
    key: 'support',
    label: 'Support & content',
    permissions: [
      { key: 'support.view', label: 'read support tickets' },
      { key: 'support.reply', label: 'reply to a ticket or change its status' },
      { key: 'support.delete', label: 'delete a ticket' },
      { key: 'helpcentre.view', label: 'read the help centre' },
      { key: 'helpcentre.edit', label: 'change help-centre articles and the guide' },
      { key: 'content.view', label: 'read quotes, tips and invite cards' },
      { key: 'content.edit', label: 'change quotes, tips and invite cards' },
    ],
  },
  {
    key: 'website',
    label: 'Website',
    permissions: [
      { key: 'website.view', label: 'read the website’s pages and documents' },
      { key: 'website.edit', label: 'edit, restore or publish website pages and documents' },
      { key: 'website.delete', label: 'delete a website document' },
      { key: 'enquiries.view', label: 'read messages from the website’s contact form' },
      { key: 'enquiries.reply', label: 'answer a website message or change its status' },
      { key: 'enquiries.delete', label: 'delete a website message' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    permissions: [
      { key: 'config.view', label: 'read the app and steps config' },
      { key: 'config.edit', label: 'change the app config' },
      { key: 'steps.edit', label: 'change the steps config' },
      { key: 'economy.view', label: 'read the step economy report' },
      { key: 'releases.view', label: 'read releases' },
      { key: 'releases.edit', label: 'record a release or move the update wall' },
      { key: 'appicon.view', label: 'read the app icon schedule' },
      { key: 'appicon.edit', label: 'change the app icon or its schedule' },
      { key: 'maintenance.view', label: 'read maintenance mode and its testers' },
      { key: 'maintenance.edit', label: 'switch maintenance mode on or off, and choose its testers' },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    permissions: [
      { key: 'staff.view', label: 'see your team' },
      { key: 'staff.manage', label: 'create and manage the people under you' },
      { key: 'audit.view', label: "read your team's activity log" },
    ],
  },
] as const;

type Group = (typeof PERMISSION_GROUPS)[number];
export type Permission = Group['permissions'][number]['key'];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(group => group.permissions.map(p => p.key));
const LABELS = new Map<string, string>(PERMISSION_GROUPS.flatMap(group => group.permissions.map(p => [p.key, p.label] as const)));

export function isPermission(value: string): value is Permission {
  return LABELS.has(value);
}

export function permissionLabel(permission: string): string {
  return LABELS.get(permission) ?? permission;
}

/**
 * The team permissions are about having people under you, which an agent
 * never has — so they are never grantable to one.
 */
const MANAGER_ONLY: ReadonlySet<Permission> = new Set(['staff.view', 'staff.manage', 'audit.view']);
export const AGENT_GRANTABLE: Permission[] = ALL_PERMISSIONS.filter(p => !MANAGER_ONLY.has(p));

export type StaffRole = 'admin' | 'manager' | 'agent';

/**
 * What a person can actually do, now.
 *
 * - **admin**: everything, always — the role is the grant.
 * - **manager**: what is stored on them.
 * - **agent**: what is stored on them, *intersected* with what their manager
 *   can do right now. A grant the manager has since lost stays on the
 *   agent's record (the panel shows it as dormant) but opens nothing.
 */
export function effectivePermissions(
  person: { role: StaffRole; permissions: readonly string[] },
  manager?: { role: StaffRole; permissions: readonly string[] } | null,
): Set<Permission> {
  if (person.role === 'admin') return new Set(ALL_PERMISSIONS);
  const own = person.permissions.filter(isPermission);
  if (person.role === 'manager') return new Set(own);
  if (!manager) return new Set();
  const above = effectivePermissions(manager);
  return new Set(own.filter(p => !MANAGER_ONLY.has(p) && above.has(p)));
}

/**
 * Starting points for the permission picker. Templates only — choosing one
 * fills the boxes, and what is saved is the boxes.
 */
export const PERMISSION_PRESETS: Array<{ key: string; label: string; forRole: Array<'manager' | 'agent'>; permissions: Permission[] }> = [
  {
    key: 'support-agent',
    label: 'Support agent',
    forRole: ['agent', 'manager'],
    permissions: [
      'members.view', 'orders.view', 'support.view', 'support.reply', 'helpcentre.view', 'notifications.view',
      'enquiries.view', 'enquiries.reply',
    ],
  },
  {
    key: 'order-desk',
    label: 'Order desk',
    forRole: ['agent', 'manager'],
    permissions: ['members.view', 'orders.view', 'orders.update', 'orders.cancel', 'support.view'],
  },
  {
    key: 'shop-operator',
    label: 'Shop operator',
    forRole: ['agent', 'manager'],
    permissions: [
      'catalogue.view', 'catalogue.edit', 'media.view', 'media.upload', 'categories.view', 'coupons.view',
      'baskets.view', 'reviews.view', 'orders.view',
    ],
  },
  {
    key: 'content-editor',
    label: 'Content editor',
    forRole: ['agent', 'manager'],
    permissions: [
      'content.view', 'content.edit', 'helpcentre.view', 'helpcentre.edit', 'challenges.view', 'challenges.edit',
      'achievements.view', 'achievements.edit', 'training.view', 'training.edit', 'nutrition.view', 'nutrition.edit',
      'website.view', 'website.edit',
    ],
  },
  {
    key: 'read-only',
    label: 'Read only',
    forRole: ['agent', 'manager'],
    permissions: ALL_PERMISSIONS.filter(p => p.endsWith('.view') && !MANAGER_ONLY.has(p)),
  },
  {
    key: 'operations-manager',
    label: 'Operations manager',
    forRole: ['manager'],
    permissions: ALL_PERMISSIONS.filter(
      p => !['config.edit', 'steps.edit', 'releases.edit', 'appicon.edit', 'maintenance.edit', 'catalogue.delete', 'nutrition.delete', 'challenges.delete'].includes(p),
    ),
  },
];

/**
 * What a route needs. A string is one permission; an array is any one of
 * them (a picker two editors share). Two markers need no permission at all:
 * `@self` is any signed-in person acting on their own account, and `@setup`
 * is the handful of routes a session may use before it has set a password
 * and enrolled an authenticator.
 */
export type RouteRule = Permission | Permission[] | '@self' | '@setup';

export const ROUTE_PERMISSIONS: Record<string, RouteRule> = {
  // ─── Team (staff/routes.ts) ───────────────────────────────────────────────
  'GET /admin/staff/me': '@setup',
  'GET /admin/staff/permissions': '@setup',
  'POST /admin/staff/me/password': '@setup',
  'POST /admin/staff/me/totp/setup': '@setup',
  'POST /admin/staff/me/totp/confirm': '@setup',
  'POST /admin/staff/logout': '@setup',
  'GET /admin/staff/me/sessions': '@self',
  'DELETE /admin/staff/me/sessions/:sessionId': '@self',
  'GET /admin/staff/me/activity': '@self',
  'GET /admin/staff/activity': 'audit.view',
  'GET /admin/staff': 'staff.view',
  'POST /admin/staff': 'staff.manage',
  'GET /admin/staff/:staffId': 'staff.view',
  'GET /admin/staff/:staffId/sessions': 'staff.view',
  'PUT /admin/staff/:staffId': 'staff.manage',
  'POST /admin/staff/:staffId/suspend': 'staff.manage',
  'POST /admin/staff/:staffId/reactivate': 'staff.manage',
  'POST /admin/staff/:staffId/reset-password': 'staff.manage',
  'POST /admin/staff/:staffId/reset-totp': 'staff.manage',
  'POST /admin/staff/:staffId/logout-all': 'staff.manage',
  'PUT /admin/staff/:staffId/manager': 'staff.manage',
  'PUT /admin/staff/:staffId/role': 'staff.manage',
  'DELETE /admin/staff/:staffId': 'staff.manage',

  // ─── Watch ───────────────────────────────────────────────────────────────
  'GET /admin/analytics/overview': 'analytics.view',
  'GET /admin/analytics/signups': 'analytics.view',
  'GET /admin/health/fleet': 'diagnose.view',

  // ─── Members ─────────────────────────────────────────────────────────────
  'GET /admin/users': 'members.view',
  'GET /admin/users/:userId': 'members.view',
  'GET /admin/users/:userId/logins': 'members.view',
  'GET /admin/users/:userId/activity': 'members.view',
  'GET /admin/users/:userId/activity/summary': 'members.view',
  'GET /admin/users/:userId/permissions': 'members.view',
  'GET /admin/users/:userId/problems': 'members.view',
  'GET /admin/users/:userId/health': 'members.view',
  'GET /admin/users/:userId/steps': 'members.view',
  'GET /admin/users/:userId/steps/timeline': 'members.view',
  'GET /admin/users/:userId/wallet': 'members.view',
  'GET /admin/users/:userId/ledger': 'members.view',
  'GET /admin/users/:userId/achievements': 'members.view',
  'GET /admin/users/:userId/orders': ['members.view', 'orders.view'],
  'GET /admin/users/:userId/audit': 'members.view',
  'GET /admin/users/:userId/config': 'members.view',
  'GET /admin/users/:userId/notifications': 'members.view',
  'GET /admin/users/:userId/basket': 'members.view',
  'PUT /admin/users/:userId/status': 'members.status',
  'PUT /admin/users/:userId/profile': 'members.edit',
  'POST /admin/users/:userId/verify-contact': 'members.edit',
  'PUT /admin/users/:userId/config': 'members.edit',
  'POST /admin/users/:userId/coins': 'members.coins',
  'POST /admin/users/:userId/achievements': 'members.badges',
  'POST /admin/users/:userId/notifications': 'members.notify',
  'POST /admin/users/:userId/sync-nudge': 'members.notify',
  'DELETE /admin/users/:userId/basket/lines': 'members.basket',
  'DELETE /admin/users/:userId/basket/coupon': 'members.basket',
  'DELETE /admin/users/:userId/basket': 'members.basket',
  'DELETE /admin/users/:userId/wishlist/:itemId': 'members.basket',
  'POST /admin/users/:userId/days/:date/rescore': ['members.steps', 'fraud.decide'],
  'PUT /admin/users/:userId/days/:date/devices/rejected': 'members.steps',

  // ─── Fraud ───────────────────────────────────────────────────────────────
  'GET /admin/fraud/queue': 'fraud.view',
  'GET /admin/fraud/users/:userId': 'fraud.view',
  'POST /admin/fraud/flags/:flagId/confirm': 'fraud.decide',
  'POST /admin/fraud/flags/:flagId/dismiss': 'fraud.decide',

  // ─── Orders ──────────────────────────────────────────────────────────────
  'GET /admin/orders': 'orders.view',
  'GET /admin/orders/:orderId': ['orders.view', 'members.view'],
  'PUT /admin/orders/:orderId/status': 'orders.update',
  'PUT /admin/orders/:orderId/address': 'orders.update',
  'POST /admin/orders/:orderId/cancel': 'orders.cancel',
  'POST /admin/orders/:orderId/refund': 'orders.refund',

  // ─── Shop ────────────────────────────────────────────────────────────────
  'GET /admin/shop/items': 'catalogue.view',
  'GET /admin/shop/items/:itemId': 'catalogue.view',
  'GET /admin/shop/items/:itemId/insight': 'catalogue.view',
  'POST /admin/shop/items': 'catalogue.edit',
  'POST /admin/shop/items/import': 'catalogue.edit',
  'PUT /admin/shop/items/:itemId': 'catalogue.edit',
  'PUT /admin/shop/items/:itemId/stock': 'catalogue.edit',
  'DELETE /admin/shop/items/:itemId': 'catalogue.edit',
  'DELETE /admin/shop/items/:itemId/permanent': 'catalogue.delete',
  'GET /admin/media': ['media.view', 'catalogue.edit', 'nutrition.edit'],
  'POST /admin/media/sign': 'media.upload',
  'POST /admin/media': 'media.upload',
  'PUT /admin/media/:mediaId': 'media.upload',
  'DELETE /admin/media/:mediaId': 'media.delete',
  'GET /admin/shop/categories': ['categories.view', 'catalogue.edit'],
  'POST /admin/shop/categories': 'categories.edit',
  'PUT /admin/shop/categories/subcategory': 'categories.edit',
  'POST /admin/shop/categories/move': 'categories.edit',
  'PUT /admin/shop/categories/:slug': 'categories.edit',
  'POST /admin/shop/categories/:slug/reorder': 'categories.edit',
  'POST /admin/shop/categories/:slug/subcategories/:name/reorder': 'categories.edit',
  'DELETE /admin/shop/categories/:slug': 'categories.edit',
  'POST /admin/shop/categories/:slug/subcategories': 'categories.edit',
  'PUT /admin/shop/categories/:slug/subcategories/:name': 'categories.edit',
  'DELETE /admin/shop/categories/:slug/subcategories/:name': 'categories.edit',
  'GET /admin/shop/coupons': 'coupons.view',
  'GET /admin/shop/coupons/:code': 'coupons.view',
  'POST /admin/shop/coupons': 'coupons.edit',
  'PUT /admin/shop/coupons/:code': 'coupons.edit',
  'PUT /admin/shop/coupons/:code/active': 'coupons.edit',
  'DELETE /admin/shop/coupons/:code': 'coupons.delete',
  'GET /admin/shop/baskets': 'baskets.view',
  'GET /admin/shop/demand': 'baskets.view',
  'GET /admin/shop/reviews': 'reviews.view',
  'PUT /admin/shop/reviews/:reviewId': 'reviews.edit',
  'DELETE /admin/shop/reviews/:reviewId': 'reviews.delete',

  // ─── Messages ────────────────────────────────────────────────────────────
  'GET /admin/notifications': 'notifications.view',
  'GET /admin/notifications/broadcasts': 'notifications.view',
  'GET /admin/notifications/preview': ['notifications.view', 'notifications.broadcast'],
  'GET /admin/notifications/consent': 'notifications.view',
  'POST /admin/notifications/broadcast': 'notifications.broadcast',
  'POST /admin/notifications/broadcasts/:dedupeKey/retract': 'notifications.retract',
  'DELETE /admin/notifications/:id': 'notifications.retract',
  // ─── Automated and scheduled messages (admin/automations.routes.ts) ───────
  'GET /admin/automations': 'notifications.view',
  'PUT /admin/automations/settings': 'notifications.automate',
  'PUT /admin/automations/:key': 'notifications.automate',
  'DELETE /admin/automations/:key': 'notifications.automate',
  'POST /admin/automations/:key/preview': 'notifications.automate',
  'POST /admin/campaigns': 'notifications.automate',
  'PUT /admin/campaigns/:id': 'notifications.automate',
  'DELETE /admin/campaigns/:id': 'notifications.automate',

  // ─── Fitness ─────────────────────────────────────────────────────────────
  'GET /admin/challenges': 'challenges.view',
  'GET /admin/challenges/:challengeId': 'challenges.view',
  'POST /admin/challenges': 'challenges.edit',
  'PUT /admin/challenges/:challengeId': 'challenges.edit',
  'DELETE /admin/challenges/:challengeId': 'challenges.edit',
  'DELETE /admin/challenges/:challengeId/permanent': 'challenges.delete',
  'GET /admin/achievements': 'achievements.view',
  'GET /admin/achievements/picker': ['achievements.view', 'challenges.edit', 'members.badges'],
  'GET /admin/achievements/:achievementId': 'achievements.view',
  'POST /admin/achievements': 'achievements.edit',
  'PUT /admin/achievements/:achievementId': 'achievements.edit',
  'DELETE /admin/achievements/:achievementId': 'achievements.edit',
  'GET /admin/training': 'training.view',
  'GET /admin/training/exercises/picker': 'training.view',
  'POST /admin/training/exercises': 'training.edit',
  'PUT /admin/training/exercises/:exerciseId': 'training.edit',
  'DELETE /admin/training/exercises/:exerciseId': 'training.edit',
  'POST /admin/training/templates': 'training.edit',
  'PUT /admin/training/templates/:templateId': 'training.edit',
  'DELETE /admin/training/templates/:templateId': 'training.edit',
  'GET /admin/leaderboard': 'leaderboard.view',

  // ─── Nutrition (nutrition/admin.routes.ts) ──────────────────────────────
  'GET /admin/nutrition/overview': 'nutrition.view',
  'GET /admin/diet-plans': 'nutrition.view',
  'GET /admin/diet-plans/:id': 'nutrition.view',
  'POST /admin/diet-plans': 'nutrition.edit',
  'PUT /admin/diet-plans/:id': 'nutrition.edit',
  'DELETE /admin/diet-plans/:id': 'nutrition.edit',
  'DELETE /admin/diet-plans/:id/permanent': 'nutrition.delete',
  'GET /admin/foods': 'nutrition.view',
  'GET /admin/foods/:id': 'nutrition.view',
  'POST /admin/foods': 'nutrition.edit',
  'POST /admin/foods/import': 'nutrition.edit',
  'PUT /admin/foods/:id': 'nutrition.edit',
  'DELETE /admin/foods/:id': 'nutrition.edit',
  'DELETE /admin/foods/:id/permanent': 'nutrition.delete',

  // ─── Support & content ──────────────────────────────────────────────────
  'GET /admin/support/tickets': 'support.view',
  'GET /admin/support/tickets/:ticketId': 'support.view',
  'POST /admin/support/tickets/:ticketId/replies': 'support.reply',
  'PUT /admin/support/tickets/:ticketId/status': 'support.reply',
  'DELETE /admin/support/tickets/:ticketId': 'support.delete',
  'GET /admin/support/faqs': 'helpcentre.view',
  'POST /admin/support/faqs': 'helpcentre.edit',
  'PUT /admin/support/faqs/:faqId': 'helpcentre.edit',
  'DELETE /admin/support/faqs/:faqId': 'helpcentre.edit',
  'GET /admin/support/guide': 'helpcentre.view',
  'POST /admin/support/guide': 'helpcentre.edit',
  'DELETE /admin/support/guide/:sectionId': 'helpcentre.edit',
  'GET /admin/tips': 'content.view',
  'POST /admin/tips': 'content.edit',
  'POST /admin/tips/bulk': 'content.edit',
  'PUT /admin/tips/:tipId': 'content.edit',
  'DELETE /admin/tips/:tipId': 'content.edit',
  'GET /admin/referral-cards': 'content.view',
  'POST /admin/referral-cards': 'content.edit',
  'PUT /admin/referral-cards/:cardId': 'content.edit',
  'DELETE /admin/referral-cards/:cardId': 'content.edit',

  // ─── Website (site/admin.routes.ts) ──────────────────────────────────────
  'GET /admin/site': ['website.view', 'enquiries.view'],
  'POST /admin/site/refresh': 'website.edit',
  'GET /admin/site/pages/:key': 'website.view',
  'PUT /admin/site/pages/:key': 'website.edit',
  'DELETE /admin/site/pages/:key': 'website.edit',
  'GET /admin/site/pages/:key/revisions': 'website.view',
  'POST /admin/site/pages/:key/restore': 'website.edit',
  'GET /admin/site/documents': 'website.view',
  'POST /admin/site/documents': 'website.edit',
  'GET /admin/site/documents/:slug': 'website.view',
  'PUT /admin/site/documents/:slug': 'website.edit',
  'DELETE /admin/site/documents/:slug': 'website.delete',
  'POST /admin/site/documents/:slug/reset': 'website.edit',
  'GET /admin/site/documents/:slug/revisions': 'website.view',
  'POST /admin/site/documents/:slug/restore': 'website.edit',
  'GET /admin/site/enquiries': 'enquiries.view',
  'GET /admin/site/enquiries/:enquiryId': 'enquiries.view',
  'PUT /admin/site/enquiries/:enquiryId': 'enquiries.reply',
  'POST /admin/site/enquiries/:enquiryId/replies': 'enquiries.reply',
  'DELETE /admin/site/enquiries/:enquiryId': 'enquiries.delete',

  // ─── System ──────────────────────────────────────────────────────────────
  'GET /admin/config': 'config.view',
  'PUT /admin/config': 'config.edit',
  'GET /admin/config/steps': 'config.view',
  'PUT /admin/config/steps': 'steps.edit',
  'GET /admin/steps/phones': 'config.view',
  'GET /admin/activity/shadow': 'economy.view',
  'GET /admin/releases': 'releases.view',
  'POST /admin/releases': 'releases.edit',
  'PUT /admin/app/update-policy': 'releases.edit',
  'GET /admin/maintenance': 'maintenance.view',
  // Every signed-in person: the header warns whoever is looking that members are kept out.
  'GET /admin/maintenance/flag': '@self',
  'PUT /admin/maintenance': 'maintenance.edit',
  'POST /admin/maintenance/testers': 'maintenance.edit',
  'DELETE /admin/maintenance/testers/:userId': 'maintenance.edit',
  'GET /admin/app-icon': 'appicon.view',
  'PUT /admin/app-icon': 'appicon.edit',
  'POST /admin/app-icon/schedule': 'appicon.edit',
  'DELETE /admin/app-icon/schedule/:windowId': 'appicon.edit',
};

/** The words a refusal uses for a rule: "refund an order", or the first of several. */
export function ruleLabel(rule: RouteRule): string {
  if (rule === '@self' || rule === '@setup') return 'use your own account';
  const first = Array.isArray(rule) ? rule[0]! : rule;
  return permissionLabel(first);
}

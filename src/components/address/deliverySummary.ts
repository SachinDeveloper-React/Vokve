import type { DeliveryPreferences } from '../../types/models';

/**
 * The delivery preferences in one line, the way they are read back under
 * an address — "Leave at door · WhatsApp updates · “Ring twice”" — or null
 * when nothing was asked for.
 */
export function deliverySummary(
  prefs: Partial<DeliveryPreferences> | null | undefined,
): string | null {
  if (!prefs) return null;
  const note = prefs.instructions?.trim();
  const parts = [
    prefs.leaveAtDoor ? 'Leave at door' : null,
    prefs.whatsappUpdates ? 'WhatsApp updates' : null,
    note ? `“${note}”` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

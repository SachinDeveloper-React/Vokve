/**
 * How a member is named to other members.
 *
 * Shared by the leaderboard and the challenge standings rather than written
 * once in each: the two lists sit a tap apart, and a member who is "Rahul V."
 * on one and "Rahul Verma" on the other has had their surname published by
 * whichever of the two was written second.
 */

/** "Rahul V." — a first name and an initial is all a public list shows of anyone. */
export function publicName(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'VOKVE member';
  return words.length === 1 ? words[0] : `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
}

/** What a list shows in place of someone who has closed their account. */
export const DELETED_MEMBER = 'Deleted member';

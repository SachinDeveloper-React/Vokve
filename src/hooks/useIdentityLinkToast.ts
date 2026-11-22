import { useEffect } from 'react';
import { useToast } from '../components/feedback/Toast';
import { useAuthStore } from '../stores/authStore';

/**
 * Says how connecting a Google or Apple identity went (RULES O15).
 *
 * The connection is made after "I already have an account" and a sign-in,
 * the moment the session starts — by then the sign-in screen is gone, so
 * the answer comes as one toast over whatever the app opened on, and is
 * then forgotten.
 */
export function useIdentityLinkToast(): void {
  const toast = useToast();
  const outcome = useAuthStore(s => s.identityLinkOutcome);
  const clear = useAuthStore(s => s.clearIdentityLinkOutcome);

  useEffect(() => {
    if (!outcome) {
      return;
    }
    toast.show({ title: outcome.title, message: outcome.message, tone: outcome.tone });
    clear();
  }, [clear, outcome, toast]);
}

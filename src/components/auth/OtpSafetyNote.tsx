import React, { memo } from 'react';
import { ShieldAlert } from 'lucide-react-native';
import { InfoNote } from '../feedback/InfoNote';

/**
 * The standing warning beside a one-time code.
 *
 * Kept as its own named component rather than inlined in the screen because
 * the wording is a security decision, not a layout one. Stating that VOKVE
 * will never ask is what gives someone on a call something concrete to check
 * the caller against; a bare "keep it secret" does not.
 */
export const OtpSafetyNote = memo(() => (
  <InfoNote
    icon={ShieldAlert}
    title="Don't share your OTP with anyone."
    message="VOKVE will never ask for your OTP."
  />
));

OtpSafetyNote.displayName = 'OtpSafetyNote';

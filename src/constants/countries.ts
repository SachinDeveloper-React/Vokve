/**
 * Dial codes for the phone field's country selector.
 *
 * A deliberately short list rather than all 250 ISO entries: every country in
 * here is one a user has to scroll past to reach theirs, and the sign-up form
 * only needs the markets the app actually ships in. Adding one is a single
 * line, so the list can grow with the rollout instead of ahead of it.
 *
 * The flag is stored as an emoji rather than an image asset — it costs no
 * bundle size, and it renders from the system font on both platforms.
 */
export interface Country {
  /** ISO 3166-1 alpha-2, and the stable key for the option. */
  code: string;
  name: string;
  /** Including the leading `+`, so it can be concatenated as-is. */
  dialCode: string;
  flag: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰' },
  { code: 'NP', name: 'Nepal', dialCode: '+977', flag: '🇳🇵' },
] as const;

/** The dial code a fresh form starts on. */
export const DEFAULT_COUNTRY_CODE = 'IN';

export const findCountry = (code: string): Country =>
  COUNTRIES.find(country => country.code === code) ?? COUNTRIES[0];

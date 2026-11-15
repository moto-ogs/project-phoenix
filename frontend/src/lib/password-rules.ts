/**
 * Client-side password strength rules shown next to password inputs on
 * invitation acceptance and similar flows. Must stay aligned with the
 * backend's authSvc.ValidatePasswordStrength (8+ chars, upper, lower,
 * digit, special). Labels are the user-facing German copy — keep them
 * consistent across forms so that copy drift cannot happen.
 */
export type PasswordRuleKey =
  "length" | "upper" | "lower" | "digit" | "special";

interface PasswordRule {
  /** Names the rule for a form with messages of its own (a translation). */
  readonly key: PasswordRuleKey;
  readonly label: string;
  readonly test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    key: "length",
    label: "Mindestens 8 Zeichen",
    test: (value) => value.length >= 8,
  },
  {
    key: "upper",
    label: "Ein Großbuchstabe",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    key: "lower",
    label: "Ein Kleinbuchstabe",
    test: (value) => /[a-z]/.test(value),
  },
  { key: "digit", label: "Eine Zahl", test: (value) => /\d/.test(value) },
  {
    key: "special",
    label: "Ein Sonderzeichen",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
];

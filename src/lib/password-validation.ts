export const PASSWORD_REQUIREMENTS =
  "Use at least 8 characters with an uppercase letter, a number, and a special character.";

export function isSignupPasswordValid(password: unknown): password is string {
  return typeof password === "string"
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-zA-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^a-zA-Z0-9\s]/.test(password);
}

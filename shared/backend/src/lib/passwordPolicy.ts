/** Password rules (setting auth.password_policy). Returns the problems in words a user can act on; empty = OK. */
export type PasswordPolicy = { minLength: number; minCharacterTypes: number; rememberLast: number };

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: 8, minCharacterTypes: 3, rememberLast: 3 };

export function passwordProblems(password: string, policy: PasswordPolicy, username?: string): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) problems.push(`Use at least ${policy.minLength} characters.`);
  if (password.length > 128) problems.push('Use at most 128 characters.');
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (types < policy.minCharacterTypes) {
    problems.push(`Mix at least ${policy.minCharacterTypes} of: lower-case letters, capital letters, numbers, symbols.`);
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    problems.push("Don't include your username or mobile number.");
  }
  return problems;
}

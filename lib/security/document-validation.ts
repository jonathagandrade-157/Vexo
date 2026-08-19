/**
 * CPF/CNPJ format + check-digit validation (architecture §13, item 3:
 * "normalização + checagem de dígito verificador do CPF/CNPJ" as a signal
 * of trial-eligibility fraud, evaluated server-side, never exposed to the
 * client as an explicit rule). Pure, no I/O, no secret — this only rejects
 * obviously-fake documents (wrong length, repeated digits, bad check
 * digits); it does not and cannot prove the document is real.
 */

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function hasAllSameDigit(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

function calculateCpfDigit(digits: string, weightStart: number): number {
  let sum = 0;
  let weight = weightStart;
  for (const digit of digits) {
    sum += Number(digit) * weight;
    weight -= 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || hasAllSameDigit(digits)) return false;

  const firstCheck = calculateCpfDigit(digits.slice(0, 9), 10);
  if (firstCheck !== Number(digits[9])) return false;

  const secondCheck = calculateCpfDigit(digits.slice(0, 10), 11);
  return secondCheck === Number(digits[10]);
}

function calculateCnpjDigit(digits: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += Number(digits[i]) * (weights[i] as number);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || hasAllSameDigit(digits)) return false;

  const firstCheck = calculateCnpjDigit(digits.slice(0, 12), CNPJ_FIRST_WEIGHTS);
  if (firstCheck !== Number(digits[12])) return false;

  const secondCheck = calculateCnpjDigit(digits.slice(0, 13), CNPJ_SECOND_WEIGHTS);
  return secondCheck === Number(digits[13]);
}

/** CPF (11 digits) or CNPJ (14 digits) — dispatches by normalized length. */
export function isValidCpfOrCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export function sanitizeDecimalInput(value) {
  const normalizedValue = String(value ?? "").replace(/,/g, ".");
  const numericValue = normalizedValue.replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = numericValue.split(".");

  if (!decimalParts.length) {
    return integerPart;
  }

  return `${integerPart}.${decimalParts.join("")}`;
}

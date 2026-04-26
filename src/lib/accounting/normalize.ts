export function normalizeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function optionalText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

export function optionalAmount(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

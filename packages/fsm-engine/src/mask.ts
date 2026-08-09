/** Shared mask helper (mirrors apps/web isStateDisabledByMask) */
export function isStateDisabledByMask(
  stateId: string,
  mask: { enabledStateIds: string[]; disabledStateIds: string[] }
): boolean {
  if (mask.disabledStateIds.includes(stateId)) return true;
  if (
    mask.enabledStateIds.length > 0 &&
    !mask.enabledStateIds.includes(stateId)
  ) {
    return true;
  }
  return false;
}

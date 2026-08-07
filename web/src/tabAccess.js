// Frontend navigation policy only improves UX. Backend authorization remains authoritative.
export function isTabAllowed(tab, me) {
  if (!tab || !me) return false;
  const canonicalCeo = !!me.is_ceo;
  return (!tab.adminOnly || !!me.isAdmin)
    && (!tab.ceoEmployeeOnly || canonicalCeo || !me.isAdmin)
    && (!tab.employeeCostControlled || !!me.isAdmin || !me.employeeCostDisabled);
}

export function resolveAllowedTab(tabs, requestedKey, me, fallbackKey = 'overview') {
  const allowed = (tabs || []).filter((tab) => isTabAllowed(tab, me));
  const requested = allowed.find((tab) => tab.key === requestedKey);
  if (requested) return requested.key;
  return allowed.find((tab) => tab.key === fallbackKey)?.key || allowed[0]?.key || fallbackKey;
}

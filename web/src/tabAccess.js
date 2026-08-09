// Frontend navigation policy only improves UX. Backend authorization remains authoritative.
export function isTabAllowed(tab, me) {
  if (!tab || !me) return false;
  if (me.access_profile === 'revenue_only') return ['revenue', 'revenueFull'].includes(tab.key);
  const canonicalCeo = !!me.is_ceo;
  return (!tab.adminOnly || !!me.isAdmin)
    && (!tab.ceoEmployeeOnly || canonicalCeo || !me.isAdmin)
    // Tab Thành tiền C32/C47: backend đã chốt trong `costAmountsEnabled` (CEO, hoặc
    // NV được bật công tắc riêng). Frontend chỉ ẩn cho gọn — route vẫn tự chặn 403.
    && (!tab.costAmountsOnly || !!me.costAmountsEnabled)
    // Tab Tổng hợp chi phí: chi tiết tiền toàn công ty — CHỈ CEO. Backend chặn
    // độc lập bằng requireCeo; ẩn tab chỉ là cho gọn menu.
    && (!tab.ceoOnly || canonicalCeo)
    && (!tab.employeeCostControlled || !!me.isAdmin || !me.employeeCostDisabled);
}

export function resolveAllowedTab(tabs, requestedKey, me, fallbackKey = 'overview') {
  const allowed = (tabs || []).filter((tab) => isTabAllowed(tab, me));
  const requested = allowed.find((tab) => tab.key === requestedKey);
  if (requested) return requested.key;
  return allowed.find((tab) => tab.key === fallbackKey)?.key || allowed[0]?.key || fallbackKey;
}

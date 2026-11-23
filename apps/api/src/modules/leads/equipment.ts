/** C-09: what the AI read off a customer's photo, as the board card shows it. Only a brand or model counts. */
export function equipmentOf(tags: unknown): string | null {
  const t = (tags ?? {}) as { brand?: string; model?: string; itemType?: string };
  const name = [t.brand, t.model]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  if (!name) return null;
  const item = t.itemType?.trim();
  return item && !name.toLowerCase().includes(item.toLowerCase())
    ? `${name} ${item.toLowerCase()}`
    : name;
}

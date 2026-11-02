/** Move `dragId` to just before or after `targetId`, returning the new id order */
export const reorderIds = (
  ids: string[],
  dragId: string,
  targetId: string,
  after: boolean
): string[] => {
  if (dragId === targetId || !ids.includes(dragId) || !ids.includes(targetId)) return ids;
  const rest = ids.filter((id) => id !== dragId);
  rest.splice(rest.indexOf(targetId) + (after ? 1 : 0), 0, dragId);
  return rest;
};

/**
 * Put a list into `folderId` (null for the top level), next to `targetId` or at the end
 * when there is no target. Renumbering the destination also clears any duplicate orders.
 */
export const placeList = <T extends { id: string; order: number; folderId?: string | null }>(
  lists: T[],
  listId: string,
  folderId: string | null,
  targetId: string | null,
  after: boolean
): T[] => {
  const ids = lists
    .filter((l) => (l.folderId ?? null) === folderId && l.id !== listId)
    .sort((a, b) => a.order - b.order)
    .map((l) => l.id);
  const at = targetId && ids.includes(targetId) ? ids.indexOf(targetId) + (after ? 1 : 0) : ids.length;
  ids.splice(at, 0, listId);
  const orderMap = new Map(ids.map((id, i) => [id, i]));
  return lists.map((l) =>
    orderMap.has(l.id)
      ? { ...l, folderId: l.id === listId ? folderId : l.folderId, order: orderMap.get(l.id)! }
      : l
  );
};

/** Ids from `a` to `b` inclusive, in either direction; empty if either is not in `ids` */
export const idsBetween = (ids: string[], a: string, b: string): string[] => {
  const from = ids.indexOf(a);
  const to = ids.indexOf(b);
  if (from === -1 || to === -1) return [];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
};

export type OrderedCareAction = { key: string };

export function moveCareAction<T extends OrderedCareAction>(actions: T[], fromKey: string, toKey: string): T[] {
  const fromIndex = actions.findIndex((action) => action.key === fromKey);
  const toIndex = actions.findIndex((action) => action.key === toKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return actions;

  const reordered = [...actions];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

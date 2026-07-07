export function moveItemById<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  if (draggedId === targetId) return items;

  const fromIndex = items.findIndex(item => item.id === draggedId);
  const targetIndex = items.findIndex(item => item.id === targetId);
  if (fromIndex < 0 || targetIndex < 0) return items;

  const nextItems = [...items];
  const [draggedItem] = nextItems.splice(fromIndex, 1);
  const insertIndex = nextItems.findIndex(item => item.id === targetId);
  nextItems.splice(insertIndex, 0, draggedItem);

  return nextItems;
}

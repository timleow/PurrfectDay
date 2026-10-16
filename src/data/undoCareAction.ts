export function undoNumericDelta(current: number, actionAmount: number) {
  return Math.max(0, current - actionAmount);
}

export function undoWetFoodDelta(cans: number, progress: number, actionAmount: number) {
  const currentTenths = cans * 10 + Math.round(progress / 10);
  const nextTenths = Math.max(0, currentTenths - Math.round(actionAmount * 10));
  return {
    cans: Math.floor(nextTenths / 10),
    canProgress: (nextTenths % 10) * 10,
  };
}

export function canUndoCareAction(actionActorUserId: string | undefined, currentUserId: string | undefined) {
  return actionActorUserId === undefined || actionActorUserId === currentUserId;
}

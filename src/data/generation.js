export function createGenerationGuard() {
  let current = 0;

  return {
    next() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
      return current;
    },
    isCurrent(generation) {
      return generation === current;
    },
    getCurrent() {
      return current;
    },
  };
}

export async function loadIfCurrent(load, guard, context = {}) {
  const generation = guard.next();
  const result = await load({ ...context, generation });
  if (!guard.isCurrent(generation)) return { committed: false, generation, data: null };
  return { committed: true, generation, data: result };
}

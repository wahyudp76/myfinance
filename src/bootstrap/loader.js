export function createBootstrapLoader(loadData) {
  let inFlight = null;
  let generation = 0;

  return {
    load(context = {}) {
      if (inFlight) return inFlight;

      const requestGeneration = ++generation;
      inFlight = Promise.resolve()
        .then(() => loadData({ ...context, generation: requestGeneration }))
        .finally(() => {
          inFlight = null;
        });

      return inFlight;
    },
    invalidate() {
      generation += 1;
    },
    getGeneration() {
      return generation;
    },
  };
}

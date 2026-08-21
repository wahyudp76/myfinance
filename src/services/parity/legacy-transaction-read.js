export function createLegacyTransactionRead({ api }) {
  if (!api?.run) throw new Error("Legacy api.run belum tersedia.");

  return () => new Promise((resolve, reject) => {
    api.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      .getTransactionsOnly();
  });
}

// Mock query-builder Supabase yang meniru sifat PostgrestFilterBuilder asli: setiap method
// chain (.select/.insert/.update/.upsert/.delete/.eq/.order/.range/.maybeSingle) MENGEMBALIKAN
// builder yang sama, dan builder itu sendiri "thenable" -- jadi bisa di-await langsung di titik
// chain manapun, persis seperti client Supabase sungguhan. Tanpa ini, kode yang meng-await
// setelah .eq() vs setelah .range() vs langsung setelah .upsert() butuh 3 mock berbeda.
export function createMockSupabaseClient({ result = { data: null, error: null }, resultProvider, authUserId = "user-1", authError = null } = {}) {
  const calls = [];
  const provider = resultProvider || (() => result);

  function createQueryBuilder(table) {
    const record = { table, filters: [], order: [] };
    calls.push(record);
    const builder = {
      select(columns) { record.method = record.method || "select"; record.columns = columns; return builder; },
      insert(payload) { record.method = "insert"; record.payload = payload; return builder; },
      update(payload) { record.method = "update"; record.payload = payload; return builder; },
      upsert(payload, options) { record.method = "upsert"; record.payload = payload; record.options = options; return builder; },
      delete() { record.method = "delete"; return builder; },
      eq(column, value) { record.filters.push([column, value]); return builder; },
      order(column, options) { record.order.push([column, options]); return builder; },
      range(from, to) { record.range = [from, to]; return builder; },
      maybeSingle() { record.single = true; return builder; },
      then(onFulfilled, onRejected) { return Promise.resolve(provider(record)).then(onFulfilled, onRejected); },
    };
    return builder;
  }

  return {
    calls,
    from(table) { return createQueryBuilder(table); },
    auth: {
      getUser: () => Promise.resolve(authError ? { data: { user: null }, error: authError } : { data: { user: { id: authUserId } }, error: null }),
    },
  };
}

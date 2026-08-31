// Jalankan SETELAH bump CACHE_VERSION di sw.js (atau setelah perubahan aset
// + bump): node tests/unit/update-sw-cache-snapshot.mjs
import { writeFileSync } from "node:fs";
import { computeSwAssetHash } from "./sw-cache-hash-helper.mjs";
const { version, hash } = await computeSwAssetHash();
writeFileSync(new URL("./sw-cache.snapshot", import.meta.url), `version=${version}\nhash=${hash}\n`, "utf8");
console.log(`snapshot ditulis: version=${version} hash=${hash.slice(0, 16)}…`);

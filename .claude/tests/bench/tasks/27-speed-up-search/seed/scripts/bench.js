const { createCatalog } = require("../src/search");
const { sampleProducts } = require("./sample-data");

const catalog = createCatalog(sampleProducts(5000));
const queries = ["lamp", "c", "blue ch", "cafe", "home", "pro case", "s", "kettle 12"];
const started = process.hrtime.bigint();
for (const query of queries) catalog.search(query, { limit: 50 });
const ms = Number(process.hrtime.bigint() - started) / 1e6;
process.stdout.write(`${queries.length} queries over 5000 products: ${ms.toFixed(1)} ms\n`);

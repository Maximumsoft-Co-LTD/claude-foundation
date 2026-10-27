// Independent HTTP worker so a single event loop cannot hide a database race.
import { pathToFileURL } from 'node:url';
const { createServer } = await import(pathToFileURL(process.argv[2]));
let time = 1000000;
const tokens = { a: { tenantId: 'a', role: 'operator' },
  b: { tenantId: 'b', role: 'operator' },
  view: { tenantId: 'a', role: 'viewer' },
  legacy: { tenantId: 'legacy', role: 'operator' } };
const server = createServer({ dbFile: process.argv[3], now: () => time, tokens });
process.on('message', (value) => { time = value; process.send({ clock: time }); });
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));

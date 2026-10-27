// Calibration answer for the lifecycle lane's landed result: the amended
// order/inventory change plus catalogue paging. Repository-only.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairOrderInventory } from './order-inventory-repair.mjs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`calibration anchor missing in ${path}`);
  writeFileSync(path, source.replace(before, after));
}

export function repairOrderInventoryLifecycle(project) {
  repairOrderInventory(project);
  cpSync(fileURLToPath(new URL('./order-inventory-lifecycle-server.mjs', import.meta.url)),
    join(project, 'backend/server.mjs'));
  replaceOnce(join(project, 'sdk/client.mjs'), "expire: () => call('POST','/v2/expire',{})",
    `expire: () => call('POST','/v2/expire',{}),
    release: (id,quantity,key) => call('POST',path('/v2/orders/',id)+'/release',{quantity},key),
    legacySkus: ({prefix,limit,cursor} = {}) => {
      const query = new URLSearchParams();
      for (const [name,value] of Object.entries({prefix,limit,cursor}))
        if (value !== undefined) query.set(name,String(value));
      const text = query.toString();
      return call('GET','/v1/skus'+(text ? '?'+text : ''));
    }`);
  replaceOnce(join(project, 'web/state.mjs'), "return {filter:'',orders:{},pending:{}};",
    "return {filter:'',orders:{},pending:{},catalogue:{items:[],nextCursor:null}};");
  replaceOnce(join(project, 'web/state.mjs'), "  if (action.type === 'reserve-start')",
    `  if (action.type === 'catalogue-loaded') {
    if (!Array.isArray(action.items)) return state;
    const known = new Set(action.append ? state.catalogue.items.map(item => item.sku) : []);
    const fresh = action.items.filter(item => !known.has(item.sku) && known.add(item.sku));
    const items = action.append ? [...state.catalogue.items, ...fresh] : action.items;
    return {...state,catalogue:{items,nextCursor:action.nextCursor ?? null}};
  }
  if (action.type === 'reserve-start')`);
}

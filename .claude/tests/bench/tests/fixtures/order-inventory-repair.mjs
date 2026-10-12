import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repairOrderInventory(project) {
  cpSync(fileURLToPath(new URL('./order-inventory-server.mjs', import.meta.url)), join(project, 'backend/server.mjs'));
  writeFileSync(join(project, 'sdk/client.mjs'), `
export function createClient({baseUrl, token}) {
  async function call(method, path, body, key) {
    const response = await fetch(baseUrl+path, {method, headers: {
      authorization: 'Bearer '+token, 'content-type': 'application/json',
      ...(key ? {'idempotency-key':key} : {})
    }, body: body === undefined ? undefined : JSON.stringify(body)});
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), {status:response.status, code:value.error});
    return value;
  }
  const path = (base, id) => base+encodeURIComponent(id);
  return {
    legacyStock: sku => call('GET',path('/v1/stock/',sku)),
    stock: sku => call('GET',path('/v2/stock/',sku)),
    setStock: (sku,stock) => call('PUT',path('/v2/stock/',sku),{stock}),
    reserve: (input,key) => call('POST','/v2/orders',input,key),
    order: id => call('GET',path('/v2/orders/',id)),
    cancel: id => call('POST',path('/v2/orders/',id)+'/cancel',{}),
    event: input => call('POST','/v2/events',input),
    expire: () => call('POST','/v2/expire',{})
  };
}
`);
  writeFileSync(join(project, 'web/state.mjs'), `
export function initialState() { return {filter:'',orders:{},pending:{}}; }
export function reduce(state, action) {
  if (action.type === 'filter') return {...state,filter:action.value};
  if (action.type === 'reserve-start') return {...state,pending:{...state.pending,[action.key]:true}};
  if (action.type === 'reserve-done' || action.type === 'order-updated') {
    const order = action.order, before = state.orders[order.id];
    const pending = {...state.pending};
    if (action.type === 'reserve-done') delete pending[action.key];
    const stale = before && (order.lastSequence < before.lastSequence ||
      (['cancelled','expired'].includes(before.status) && ['reserved','confirmed'].includes(order.status)));
    return {...state,pending,orders:stale ? state.orders : {...state.orders,[order.id]:order}};
  }
  return state;
}
`);
  writeFileSync(join(project, 'backend/reservation.test.mjs'), `
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from './server.mjs';
test('reserve, replay, cancel and expiry preserve inventory', async () => {
  const dir=mkdtempSync(join(tmpdir(),'reserve-')); let time=100;
  const server=createServer({dbFile:join(dir,'data.sqlite'),now:()=>time,tokens:{a:{tenantId:'a',role:'operator'}}});
  try {
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const base='http://127.0.0.1:'+server.address().port;
    const call=async(method,path,body,key)=>{
      const r=await fetch(base+path,{method,headers:{authorization:'Bearer a',...(key?{'idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined});
      return {status:r.status,value:await r.json()};
    };
    assert.equal((await call('PUT','/v2/stock/x',{stock:2})).status,200);
    const input={sku:'x',quantity:1,ttlMs:10};
    const first=await call('POST','/v2/orders',input,'key'); assert.equal(first.status,201);
    assert.deepEqual((await call('POST','/v2/orders',input,'key')).value,first.value);
    assert.equal((await call('POST','/v2/events',{eventId:'e',orderId:first.value.id,sequence:1,type:'confirmed'})).value.status,'confirmed');
    const path='/v2/orders/'+first.value.id+'/cancel';
    assert.equal((await call('POST',path,{})).value.status,'cancelled');
    await call('POST',path,{});
    assert.equal((await call('GET','/v2/stock/x')).value.stock,2);
    await call('POST','/v2/orders',input,'expire'); time=110;
    assert.equal((await call('POST','/v2/expire',{})).value.expired,1);
    assert.equal((await call('GET','/v2/stock/x')).value.stock,2);
  } finally {server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(dir,{recursive:true,force:true});}
});
`);
  writeFileSync(join(project, 'sdk/reservation.test.mjs'), `
import assert from 'node:assert/strict';
import test from 'node:test';
import {createClient} from './client.mjs';
test('SDK forwards auth and key and exposes structured failures',async()=>{
  const original=globalThis.fetch;
  const client=createClient({baseUrl:'http://test',token:'opaque'});
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.headers.authorization,'Bearer opaque');
    assert.equal(options.headers['idempotency-key'],'repeat');
    assert.equal(options.method,'POST');assert.equal(url,'http://test/v2/orders');
    return {ok:true,json:async()=>({id:'one'})};
  };
  try {
    assert.deepEqual(await client.reserve({sku:'x',quantity:1,ttlMs:1},'repeat'),{id:'one'});
    globalThis.fetch=async()=>({ok:false,status:409,json:async()=>({error:'OUT_OF_STOCK'})});
    await assert.rejects(()=>client.stock('x'),e=>e.status===409&&e.code==='OUT_OF_STOCK');
  } finally {globalThis.fetch=original;}
});
`);
  writeFileSync(join(project, 'web/reservation.test.mjs'), `
import assert from 'node:assert/strict';
import test from 'node:test';
import {initialState,reduce} from './state.mjs';
test('completion retains filter and cannot resurrect a terminal order',()=>{
  const before=reduce(initialState(),{type:'filter',value:'shoe'});
  const pending=reduce(before,{type:'reserve-start',key:'one'});
  const order={id:'o',status:'cancelled',lastSequence:3};
  const after=reduce(pending,{type:'reserve-done',key:'one',order});
  assert.equal(after.filter,'shoe');assert.deepEqual(after.pending,{});assert.equal(after.orders.o.status,'cancelled');
  assert.deepEqual(pending.pending,{one:true});
  assert.deepEqual(reduce(after,{type:'order-updated',order:{...order,status:'confirmed',lastSequence:4}}),after);
});
`);
}

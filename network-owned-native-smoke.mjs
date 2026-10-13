import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const owned = mkdtempSync(resolve(tmpdir(), 'helix-native-owned-'));
process.env.HELIX_QUALIFICATION_UNIX_ROOTS = JSON.stringify([owned]);
await import('./network-guard.mjs');
const server = http.createServer((_request, response) => response.end('owned loopback'));
const unix = net.createServer(socket => socket.end('owned Unix'));
const watchdog = setTimeout(() => { console.error('Native transport smoke timeout'); process.exit(1); }, 20000);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(ready => unix.listen(resolve(owned, 'smoke.sock'), ready));
const get = options => new Promise((resolve, reject) => {
 const request = http.get(options, response => {let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve(body));});
 request.on('error',reject);request.setTimeout(5000,()=>request.destroy(new Error('owned request timeout')));
});
try {
 const port = server.address().port;
 for (const autoSelectFamily of [false, true]) {
  let allSeen;
  const body = await get({host:'localhost',port,agent:false,path:'/fixture',autoSelectFamily,lookup:(_h,options,cb)=>{
   allSeen = Boolean(options.all);
   return options.all ? cb(null,[{address:'127.0.0.1',family:4}]) : cb(null,'127.0.0.1',4);
  }});
  assert.equal(body,'owned loopback');assert.equal(allSeen,autoSelectFamily);
 }
 await assert.rejects(get({host:'localhost',port,agent:false,path:'/denied',lookup:(_h,options,cb)=>options.all ? cb(null,[{address:'203.0.113.1',family:4}]) : cb(null,'203.0.113.1',4)}), /qualification denies non-loopback DNS result/);
 assert.throws(()=>net.connect({host:'localhost',port,path:'/unowned-native-smoke.sock'}), /denies unowned/);
 const unixBody = await new Promise((resolveBody,reject)=>{
  let body='';const socket=net.connect({path:resolve(owned,'smoke.sock')});socket.setTimeout(5000,()=>socket.destroy(new Error('owned Unix timeout')));socket.on('error',reject);socket.on('data',chunk=>body+=chunk);socket.on('end',()=>resolveBody(body));
 });
 assert.equal(unixBody,'owned Unix');
 if (process.argv.includes('--playwright')) {
  const require = createRequire(resolve('candidate/package.json'));
  const { request } = require('@playwright/test');
  const context = await request.newContext({timeout:5000});
  try {const response = await context.get('http://localhost:' + port + '/playwright');assert.equal(response.status(),200);assert.equal(await response.text(),'owned loopback');}
  finally {await context.dispose();}
  console.log('Actual Playwright API request confined loopback smoke PASS');
 }
 console.log('Actual Node HTTP scalar/all:true, denied external DNS, owned Unix and denied unowned mixed socket smoke PASS');
} finally {clearTimeout(watchdog);await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>unix.close(resolve));rmSync(owned,{recursive:true,force:true});}

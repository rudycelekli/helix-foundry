import net from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const roots = JSON.parse(process.env.HELIX_QUALIFICATION_UNIX_ROOTS || '[]').map(root => realpathSync(root));
const within = (path, root) => path === root || path.startsWith(root + sep);
function ownedUnix(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  const path = resolve(value); let parent = dirname(path);
  while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
  const physical = resolve(realpathSync(parent), path.slice(parent.length).replace(/^[/\\]+/, ''));
  return roots.some(root => within(physical, root));
}
function loopback(host) {
  host = String(host || 'localhost').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || (net.isIP(host) === 4 && host.startsWith('127.'))
    || (net.isIP(host) === 6 && host.startsWith('::ffff:127.'));
}
function confinedLookup(lookup) {
  if (typeof lookup !== 'function') throw new Error('qualification denies invalid DNS lookup');
  return function (hostname, options, callback) {
    if (!loopback(hostname)) throw new Error('qualification denies non-loopback lookup host');
    if (typeof options === 'function') { callback = options; options = {}; }
    let completed = false;
    const done = (error, address, family) => {
      if (completed) return; completed = true;
      if (error) return callback(error);
      const entries = Array.isArray(address) ? address : [{ address, family }];
      const valid = entries.length > 0 && entries.every(entry => {
        const ipFamily = net.isIP(entry?.address);
        return ipFamily !== 0 && loopback(entry.address) && entry.family === ipFamily;
      });
      if (!valid) return callback(new Error('qualification denies non-loopback DNS result'));
      return Array.isArray(address) ? callback(null, address) : callback(null, address, family);
    };
    try { return lookup.call(this, hostname, options, done); } catch (error) { if (completed) throw error; return done(error); }
  };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  if (typeof first === 'string') {
    if (!ownedUnix(first)) throw new Error('qualification denies unowned Unix socket');
  } else {
    const options = typeof first === 'object' && first !== null ? first : { host: typeof normalized[1] === 'string' ? normalized[1] : undefined };
    if (options.path) {
      if (!ownedUnix(options.path)) throw new Error('qualification denies unowned Unix socket');
      if (options.port !== undefined && !loopback(options.host)) throw new Error('qualification denies non-loopback mixed socket options');
    } else {
      if (!loopback(options.host)) throw new Error('qualification denies non-loopback network');
      if (options.lookup !== undefined) {
        const guarded = { ...options, lookup: confinedLookup(options.lookup) };
        if (Array.isArray(args[0])) args = [guarded, ...normalized.slice(1)];
        else args = [guarded, ...args.slice(1)];
      }
    }
  }
  return connect.apply(this, args);
};
globalThis[Symbol.for('helix.qualification.network-guard')] = true;
syncBuiltinESMExports();

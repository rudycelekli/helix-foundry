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
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  if (typeof first === 'string') {
    if (!ownedUnix(first)) throw new Error('qualification denies unowned Unix socket');
  } else {
    const options = typeof first === 'object' && first !== null ? first : { host: typeof normalized[1] === 'string' ? normalized[1] : undefined };
    if (options.path !== undefined && options.port === undefined) {
      if (!ownedUnix(options.path)) throw new Error('qualification denies unowned Unix socket');
    } else if (!loopback(options.host) || options.lookup !== undefined) {
      throw new Error('qualification denies non-loopback or custom DNS network');
    }
  }
  return connect.apply(this, args);
};
globalThis[Symbol.for('helix.qualification.network-guard')] = true;
syncBuiltinESMExports();

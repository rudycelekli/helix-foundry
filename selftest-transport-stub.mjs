import net from 'node:net';
globalThis[Symbol.for('helix.qualification.transport-calls')] = [];
net.Socket.prototype.connect = function (...args) {
  globalThis[Symbol.for('helix.qualification.transport-calls')].push(args);
  return this; // Self-tests never connect, including when a rejection fails.
};

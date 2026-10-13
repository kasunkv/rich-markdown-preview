const vm = require('node:vm');
/** Simulate primitive IPC records in the extension realm without reading accessors. */
exports.wireParser = context => {
  const record = vm.runInContext('(entries) => Object.fromEntries(entries)', context);
  return message => {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
        Object.getPrototypeOf(message) !== Object.prototype || Object.getOwnPropertySymbols(message).length) return message;
    const descriptors = Object.getOwnPropertyDescriptors(message);
    if (!Object.values(descriptors).every(descriptor => 'value' in descriptor &&
        (descriptor.value === null || !['object', 'function', 'symbol'].includes(typeof descriptor.value)))) return message;
    return record(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  };
};

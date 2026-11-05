'use strict';
var os = require('os');
function localLanAddresses() {
    var found = [], interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach(function (name) {
        (interfaces[name] || []).forEach(function (entry) {
            if (entry.internal || entry.family !== 'IPv4' && entry.family !== 4) return;
            var parts = String(entry.address).split('.').map(Number);
            if (parts.length !== 4 || parts.some(function (n) { return !Number.isInteger(n) || n < 0 || n > 255; })) return;
            if (!(parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
                parts[0] === 192 && parts[1] === 168)) return;
            if (found.indexOf(entry.address) < 0) found.push(entry.address);
        });
    });
    return found.slice(0, 3);
}
module.exports = {localLanAddresses: localLanAddresses};

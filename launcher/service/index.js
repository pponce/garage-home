'use strict';
var service = null;
function start() {
    if (service) return;
    try {
        service = require('./server').create();
        service.start(function (error) {
            if (error) { service = null; console.log('Garage Home reply service unavailable'); }
        });
    } catch (_) { service = null; console.log('Garage Home reply service unavailable'); }
}
function stop() {
    if (service) service.stop();
    service = null;
}
module.exports.onStart = start;
module.exports.onRequest = start;
module.exports.onStop = stop;
module.exports.onExit = stop;

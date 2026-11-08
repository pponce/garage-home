// Local widget requests use a fixed set of stock Vetro operations.
'use strict';
var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var createReader = require('./vetro-replies').createReader;
var PORT = 8092;
function create(options) {
    options = options || {};
    var key = options.key;
    if (!key) {
        var source = fs.readFileSync(path.join(__dirname, '..', 'local-key.js'), 'utf8');
        var match = /GARAGE_LOCAL_KEY\s*=\s*['"]([a-f0-9]{64})['"]/.exec(source);
        key = match && match[1];
    }
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw Error('Local reply key unavailable');
    var stock = options.stock || require('./vetro-stock').create();
    var reader = options.reader || createReader(), active = 0, count = 0, since = Date.now();
    var server = http.createServer(function (req, res) {
        function send(status, body) {
            res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store',
                'Access-Control-Allow-Origin':'null', 'X-Content-Type-Options':'nosniff'});
            res.end(JSON.stringify(body));
        }
        var remote = req.socket.remoteAddress, port = server.address() && server.address().port;
        var origin = req.headers.origin;
        if (remote !== '127.0.0.1' || req.headers.host !== '127.0.0.1:' + port ||
            origin !== undefined && origin !== 'null') return send(403, {error:'local_only'});
        if (req.method === 'OPTIONS' && origin === 'null' && req.headers['access-control-request-method'] === 'GET' &&
            String(req.headers['access-control-request-headers'] || '').toLowerCase() === 'x-garage-key' &&
            (req.url === '/health' || /^\/replies\/[a-f0-9]{64}$/.test(req.url))) {
            res.writeHead(204, {'Access-Control-Allow-Origin':'null','Access-Control-Allow-Methods':'GET',
                'Access-Control-Allow-Headers':'X-Garage-Key','Cache-Control':'no-store'});
            res.end(); return;
        }
        if (req.method === 'OPTIONS' && origin === 'null' && req.url === '/stock' &&
            req.headers['access-control-request-method'] === 'POST' &&
            String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(function(x){return x.trim();}).sort().join(',') === 'content-type,x-garage-key') {
            res.writeHead(204,{'Access-Control-Allow-Origin':'null','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'X-Garage-Key, Content-Type'});res.end();return;
        }
        var given = req.headers['x-garage-key'];
        if (typeof given !== 'string' || !/^[a-f0-9]{64}$/.test(given) ||
            !crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(key, 'hex')))
            return send(403, {error:'local_only'});
        if (req.url === '/stock' && req.method === 'POST') {
            if (req.headers['content-type'] !== 'application/json' || active) return send(400,{error:'busy'});
            active++; var body='', completed=false, timer=setTimeout(function(){finish(408,{error:'timeout'});},70000);
            function finish(status,value){if(completed)return;completed=true;active--;clearTimeout(timer);send(status,value);}
            req.on('data',function(b){body+=b;if(body.length>2048){finish(413,{error:'size'});req.resume();}});
            req.on('error',function(){finish(400,{error:'request'});});
            req.on('end',function(){if(completed)return;var p;try{p=JSON.parse(body);if(!p||typeof p.method!=='string'||!p.params||typeof p.params!=='object'||Array.isArray(p.params))throw Error();}catch(_){finish(400,{error:'request'});return;}
                stock.call(p.method,p.params).then(function(r){finish(200,r);},function(e){finish(502,{error:'unavailable',submitted:e.submitted===false?false:null});});});return;
        }
        if (req.method !== 'GET' || req.headers['transfer-encoding'] ||
            req.headers['content-length'] && req.headers['content-length'] !== '0')
            return send(405, {error:'get_only'});
        if (Date.now() - since >= 10000) { since = Date.now(); count = 0; }
        if (++count > 80 || active >= 4) return send(429, {error:'busy'});
        if (req.url === '/health') return send(200, {ok:true, protocol:1});
        var match = /^\/replies\/([a-f0-9]{64})$/.exec(req.url);
        if (!match) return send(404, {error:'not_found'});
        active++;
        Promise.resolve().then(function () { return reader(match[1]); }).then(function (reply) {
            active--; send(reply.status, reply.body);
        }, function () { active--; send(502, {error:'reply_unavailable'}); });
    });
    server.timeout = 75000;
    server.headersTimeout = 5000;
    server.maxHeadersCount = 20;
    return {
        start: function (done) { server.once('error', done); server.listen(options.port === undefined ? PORT : options.port, '127.0.0.1', done); },
        stop: function (done) { server.close(done); },
        address: function () { return server.address(); }
    };
}
module.exports = {create:create, PORT:PORT};

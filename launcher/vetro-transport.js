/* Start this package service and send its fixed stock Vetro controls. */
(function (root) {
    'use strict';
    var starting = null, started = false, base = 'http://127.0.0.1:8092';
    function unavailable() {
        var error = Error('Open Vetro and connect root, then try again.');
        error.code = 'unavailable'; error.submitted = false; return error;
    }
    function read(path) {
        return new Promise(function (resolve, reject) {
            var key = root.GARAGE_LOCAL_KEY;
            if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return reject(unavailable());
            var xhr = new XMLHttpRequest();
            xhr.open('GET', base + path, true);
            xhr.timeout = 3500;
            xhr.setRequestHeader('X-Garage-Key', key);
            xhr.onload = function () {
                if ([200,202,404].indexOf(xhr.status) < 0 || xhr.responseText.length > 36864) return reject(unavailable());
                try { resolve({status:xhr.status, body:xhr.status === 200 ? JSON.parse(xhr.responseText) : null}); }
                catch (_) { reject(unavailable()); }
            };
            xhr.onerror = xhr.ontimeout = function () { reject(unavailable()); };
            xhr.send();
        });
    }
    function launch() {
        return new Promise(function (resolve, reject) {
            var tz = root.tizen;
            if (!tz || !tz.application) return reject(unavailable());
            var timer = setTimeout(function () { reject(unavailable()); }, 4000);
            function done() { clearTimeout(timer); resolve(); }
            function fail() { clearTimeout(timer); reject(unavailable()); }
            function direct() {
                try { tz.application.launch('GarageHome.Controls', done, fail); } catch (_) { fail(); }
            }
            try {
                tz.application.launchAppControl(new tz.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
                    'GarageHome.Controls', done, direct);
            } catch (_) { direct(); }
        });
    }
    function health() {
        return read('/health').then(function (result) {
            if (result.status !== 200 || !result.body || result.body.ok !== true || result.body.protocol !== 1) throw unavailable();
        });
    }
    function start() {
        if (starting) return starting;
        starting = (started ? health().catch(function () { started = false; return launch(); }) : launch()).then(function () {
            var until = Date.now() + 5000;
            function check() {
                return health().catch(function (error) {
                    if (Date.now() >= until) throw error;
                    return new Promise(function (resolve) { setTimeout(resolve,250); }).then(check);
                });
            }
            return check();
        }).then(function () { started = true; starting = null; }, function (error) {
            started = false; starting = null; throw error;
        });
        return starting;
    }
    function call(method, params) { return new Promise(function(resolve,reject){
        var xhr=new XMLHttpRequest();xhr.open('POST',base+'/stock',true);xhr.timeout=75000;
        xhr.setRequestHeader('X-Garage-Key',root.GARAGE_LOCAL_KEY);xhr.setRequestHeader('Content-Type','application/json');
        function failed(){var e=unavailable();e.submitted=null;reject(e);}
        xhr.onerror=xhr.ontimeout=failed;xhr.onload=function(){try{var d=JSON.parse(xhr.responseText);if(xhr.status!==200){var e=unavailable();e.submitted=d.submitted===false?false:null;reject(e);}else resolve(d);}catch(_){failed();}};
        xhr.send(JSON.stringify({method:method,params:params}));
    }); }
    root.GarageVetroTransport = {start:start,call:call, readReply:function (id) {
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return Promise.reject(unavailable());
        return read('/replies/' + id);
    }};
}(this));

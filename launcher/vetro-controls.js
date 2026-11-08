(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GarageVetroControls = factory();
}(this, function () {
    'use strict';
    var BASE = ['tasks.read','tasks.stop','remote.audio','power.off'];
    var AUDIO = ['XF86AudioLowerVolume','XF86AudioRaiseVolume','XF86AudioMute'];
    var PREF = 'gh.tvBrightness';
    function fault(code, message) { var e = Error(message); e.code = code; e.submitted = false; return e; }
    function create(options) {
        var storage = options.storage, client = null;
        var api = {busy:false, state:'unknown', scopes:[]};
        api.brightnessEnabled = function () {
            try { return storage.getItem(PREF) === 'true'; } catch (_) { return false; }
        };
        api.setBrightnessEnabled = function (enabled) {
            storage.setItem(PREF, enabled === true ? 'true' : 'false');
            if (api.brightnessEnabled() !== enabled) throw fault('storage','The brightness preference could not be saved.');
        };
        api.requestedScopes = function () { return BASE.concat(api.brightnessEnabled() ? ['picture.brightness'] : []); };
        function send(method, params) {
            if (!client) client = options.client();
            return client.call(method, params);
        }
        function exclusive(task) {
            if (api.busy) return Promise.reject(fault('busy','Wait for the current control to finish.'));
            api.busy = true;
            return Promise.resolve().then(options.start).then(task).then(function (value) {
                api.busy = false; return value;
            }, function (error) {
                api.busy = false;
                if (['disabled','permission_denied','identity_changed','unavailable'].indexOf(error.code) >= 0) {
                    api.state = error.code; api.scopes = [];
                }
                throw error;
            });
        }
        function remember(status) {
            if (!status || ['approved','unapproved','pending'].indexOf(status.state) < 0 ||
                status.scopes !== undefined && !Array.isArray(status.scopes)) throw fault('invalid_reply','Invalid connection status.');
            api.state = status.state; api.scopes = (status.scopes || []).slice();
            return status;
        }
        api.refresh = function () { return exclusive(function () { return send('access.status',{}).then(remember); }); };
        api.connect = function () { return exclusive(function () {
            return send('access.request',{scopes:api.requestedScopes()}).then(remember);
        }); };
        function submitted(result) {
            if (!result || result.ok !== true || result.submitted !== true) {
                var e = Error('The TV command was not confirmed.'); e.code = 'not_confirmed'; e.submitted = null; throw e;
            }
            return result;
        }
        api.audio = function (key) {
            if (AUDIO.indexOf(key) < 0) return Promise.reject(fault('not_allowed','Unsupported audio control.'));
            return exclusive(function () { return send('audio.key',{key:key}).then(submitted); });
        };
        api.powerOff = function (stillWanted) { return exclusive(function () {
            if (stillWanted && !stillWanted()) throw fault('cancelled','Sleep timer cancelled.');
            return send('power.off',{}).then(submitted);
        }); };
        api.tasks = function () { return exclusive(function () {
            var entries = [], pages = 0, seen = {};
            function page(offset) {
                return send('tasks.list',{offset:offset,limit:20}).then(function (result) {
                    if (!result || !Array.isArray(result.apps) || result.apps.length > 20) throw fault('invalid_reply','Invalid running-app list.');
                    result.apps.forEach(function (app) {
                        if (!app || typeof app.appId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(app.appId) ||
                            app.running !== true || typeof app.name !== 'string' || seen[app.appId] ||
                            app.memoryBytes !== null && (!Number.isFinite(app.memoryBytes) || app.memoryBytes < 0))
                            throw fault('invalid_reply','Invalid running-app entry.');
                        seen[app.appId] = true;
                        if (app.appId !== 'GarageHome.launcher' && !/^vetrotvapp(?:\.|$)/.test(app.appId)) entries.push(app);
                    });
                    if (result.nextOffset === null) return entries;
                    if (++pages >= 10 || result.nextOffset !== offset + 20) throw fault('limit','The running-app list could not be completed.');
                    return page(result.nextOffset);
                });
            }
            return page(0);
        }); };
        api.stop = function (appId) {
            if (typeof appId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(appId) ||
                appId === 'GarageHome.launcher' || /^vetrotvapp(?:\.|$)/.test(appId))
                return Promise.reject(fault('not_allowed','This app cannot be closed here.'));
            return exclusive(function () { return send('tasks.stop',{appId:appId}).then(function (result) {
                if (!result || result.ok !== true || result.verified !== true || result.appId !== appId) {
                    var e = Error('The app may still be running or may have restarted. Refresh running apps.');
                    e.code = 'not_confirmed'; e.submitted = null; throw e;
                }
                return result;
            }); });
        };
        api.brightness = function (step) {
            return exclusive(function () {
                if (!api.brightnessEnabled()) throw fault('brightness_off','Enable TV brightness in Vetro controls first.');
                return send('brightness.read',{}).then(function (current) {
                    if (!api.brightnessEnabled()) throw fault('brightness_off','TV brightness controls are off.');
                    if (!current || !Number.isInteger(current.value) || !Number.isInteger(current.min) ||
                        !Number.isInteger(current.max) || current.min > current.max || current.value < current.min ||
                        current.value > current.max || !Number.isInteger(step) || Math.abs(step) > 5)
                        throw fault('invalid_reply','Brightness support could not be confirmed.');
                    var value = Math.max(current.min, Math.min(current.max,current.value + step));
                    if (value === current.value) return current.value;
                    return send('brightness.set',{value:value,expected:current.value}).then(function (result) {
                        if (!result || result.ok !== true || result.verified !== true || result.value !== value) {
                            var e = Error('Brightness could not be confirmed. Check the TV picture settings.');
                            e.code = 'not_confirmed'; e.submitted = null; throw e;
                        }
                        return result.value;
                    });
                });
            });
        };
        api.errorMessage = function (error) {
            var messages = {
                disabled:'Open Vetro and connect root, then connect from Vetro controls.',
                permission_denied:'Open Vetro and check the connection before trying again.',
                identity_changed:'Reconnect from Vetro controls.',
                unavailable:'Open Vetro and connect root, then try again.',
                busy:'Wait for the current control to finish.',
                not_allowed:'Vetro does not permit this operation for that app.',
                brightness_off:'TV brightness controls are off.',
                limit:'Vetro is busy. Wait a moment before checking again.'
            };
            if (error && messages[error.code]) return messages[error.code];
            if (error && error.code === 'not_confirmed') return error.message;
            return 'No confirmation from Vetro. Check the TV before trying again.';
        };
        return api;
    }
    return {create:create};
}));

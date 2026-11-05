(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GarageSleepTimer = factory();
}(this, function () {
    'use strict';
    var KEY = 'gh.sleep', APP = 'GarageHome.launcher';
    function create(options) {
        var storage = options.storage, tz = options.tizen, now = options.now || Date.now;
        function read() {
            try {
                var s = JSON.parse(storage.getItem(KEY));
                return s && typeof s.id === 'string' && Number.isFinite(s.at) &&
                    typeof s.token === 'string' && /^[a-f0-9]{32}$/.test(s.token) ? s : null;
            } catch (_) { return null; }
        }
        function save(value) {
            storage.setItem(KEY, JSON.stringify(value));
            if (storage.getItem(KEY) !== JSON.stringify(value)) throw Error('The sleep timer could not be saved.');
        }
        function remove(s) { if (s) { try { tz.alarm.remove(s.id); } catch (_) {} } }
        return {
            state: function () { var s = read(); return s && s.at > now() ? s : null; },
            cancel: function () { var old = read(); save(null); remove(old); },
            schedule: function (minutes) {
                if ([15,30,60,90].indexOf(minutes) < 0) throw Error('Choose 15, 30, 60 or 90 minutes.');
                var random = new Uint8Array(16), token = '';
                options.crypto.getRandomValues(random);
                for (var i=0;i<random.length;i++) token += ('0' + random[i].toString(16)).slice(-2);
                var old = read(), at = now() + minutes * 60000, alarm = new tz.AlarmRelative(minutes * 60);
                var control = new tz.ApplicationControl('http://tizen.org/appcontrol/operation/default',null,null,null,
                    [new tz.ApplicationControlData('action',['sleep']),new tz.ApplicationControlData('sleepToken',[token])]);
                tz.alarm.add(alarm, APP, control);
                if (typeof alarm.id !== 'string' || !alarm.id) throw Error('The TV did not confirm its sleep alarm.');
                var next = {id:alarm.id,at:at,token:token};
                try { save(next); } catch (error) { remove(next); throw error; }
                remove(old);
                return next;
            },
            consume: function (data) {
                var s = read();
                if (!s || !Array.isArray(data)) return false;
                var actions = data.filter(function (d) { return d.key === 'action'; });
                var tokens = data.filter(function (d) { return d.key === 'sleepToken'; });
                if (actions.length !== 1 || tokens.length !== 1 || !Array.isArray(actions[0].value) ||
                    !Array.isArray(tokens[0].value) || actions[0].value.length !== 1 || tokens[0].value.length !== 1 ||
                    actions[0].value[0] !== 'sleep' || tokens[0].value[0] !== s.token) return false;
                if (now() < s.at) return false;
                save(null); remove(s);
                return now() - s.at <= 120000;
            }
        };
    }
    return {create:create};
}));

/* Samsung TVWindow input selection. Uses only public Tizen APIs. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GarageSources = factory();
}(this, function () {
    'use strict';
    function fault(code, message) { var error = Error(message); error.code = code; return error; }
    function key(source) {
        if (!source || ['HDMI','TV'].indexOf(source.type) < 0 || !Number.isInteger(source.number) ||
            source.number < 0 || source.number > 64) return null;
        return source.type + ':' + source.number;
    }
    function create(options) {
        var tz = options.tizen, timeout = options.timeoutMs || 6000, api = {busy:false};
        function call(register, timeoutCode) {
            return new Promise(function (resolve, reject) {
                var settled = false, timer = setTimeout(function () {
                    finish(fault(timeoutCode,'The TV did not confirm this request.'));
                }, timeout);
                function finish(error, result) {
                    if (settled) return;
                    settled = true; clearTimeout(timer);
                    if (error) reject(error); else resolve(result);
                }
                try { register(function (result) { finish(null,result); },function (error) { finish(error || fault('unavailable','Input controls are unavailable.')); }); }
                catch (error) { finish(error); }
            });
        }
        function read() {
            if (!tz || !tz.systeminfo || !tz.tvwindow || typeof tz.tvwindow.setSource !== 'function')
                return Promise.reject(fault('unavailable','Input controls are unavailable on this TV.'));
            return call(function (done, fail) {
                tz.systeminfo.getPropertyValue('VIDEOSOURCE',done,fail);
            },'read_timeout').then(function (info) {
                if (!info || !Array.isArray(info.connected) || !Array.isArray(info.disconnected) ||
                    info.connected.length + info.disconnected.length > 64)
                    throw fault('unavailable','The TV did not return a valid input list.');
                var rows = [], seen = {}, current = null;
                try { current = key(tz.tvwindow.getSource('MAIN')); } catch (_) {}
                function add(source, connected) {
                    var id = key(source);
                    if (!id || seen[id]) return;
                    seen[id] = true;
                    rows.push({id:id, label:source.type === 'TV' ? 'Live TV' : 'HDMI ' + source.number,
                        type:source.type,number:source.number,connected:connected,current:id === current,native:source});
                }
                info.connected.forEach(function (source) { add(source,true); });
                info.disconnected.forEach(function (source) { add(source,false); });
                rows.sort(function (a,b) { return a.type === b.type ? a.number-b.number : a.type === 'HDMI' ? -1 : 1; });
                return rows;
            });
        }
        function summary(source) {
            return {id:source.id,label:source.label,type:source.type,number:source.number,
                connected:source.connected,current:source.current};
        }
        function guard(stillWanted) {
            if (stillWanted && !stillWanted()) throw fault('cancelled','Input selection cancelled.');
        }
        function viewer(stillWanted) {
            return call(function (done, fail) {
                guard(stillWanted);
                tz.application.launch('org.tizen.tv-viewer',done,fail);
            },'viewer_timeout').then(function () { return true; },function (error) {
                if (error.code === 'viewer_timeout' || error.code === 'cancelled') return false;
                // An explicit launch failure permits the alternative public launch API.
                // A timeout is ambiguous and is never retried.
                return call(function (done, fail) {
                    guard(stillWanted);
                    tz.application.launchAppControl(new tz.ApplicationControl('http://tizen.org/appcontrol/operation/default',null,null,null,null),
                        'org.tizen.tv-viewer',done,fail);
                },'viewer_timeout').then(function () { return true; },function () { return false; });
            });
        }
        api.list = function () { return read().then(function (rows) { return rows.map(summary); }); };
        api.select = function (id, stillWanted) {
            if (api.busy) return Promise.reject(fault('busy','An input change is already in progress.'));
            if (typeof id !== 'string' || !/^(HDMI|TV):\d{1,2}$/.test(id))
                return Promise.reject(fault('missing','That input is not available. Refresh the list.'));
            api.busy = true;
            return read().then(function (rows) {
                guard(stillWanted);
                var target = rows.filter(function (source) { return source.id === id; })[0];
                if (!target) throw fault('missing','That input is no longer reported by the TV. Refresh the list.');
                return call(function (done, fail) {
                    guard(stillWanted);
                    tz.tvwindow.setSource(target.native,done,fail,'MAIN');
                },'not_confirmed').then(function (reported) {
                    guard(stillWanted);
                    var confirmed = key(reported);
                    try { confirmed = key(tz.tvwindow.getSource('MAIN')); } catch (_) {}
                    if (confirmed !== id) throw fault('not_confirmed','The input change was not confirmed. Check the TV before trying again.');
                    target.current = true;
                    return viewer(stillWanted).then(function (submitted) {
                        return {source:summary(target),viewerSubmitted:submitted};
                    });
                });
            }).then(function (result) { api.busy = false; return result; },function (error) {
                api.busy = false; throw error;
            });
        };
        api.errorMessage = function (error) {
            var messages = {
                busy:'An input change is already in progress.',
                missing:'That input is no longer available. Refresh the list.',
                read_timeout:'The TV did not return its inputs. Select Refresh to try again.',
                not_confirmed:'The input change was not confirmed. Check the TV before trying again.',
                cancelled:'Input selection cancelled.',
                unavailable:'Input controls are unavailable on this TV.'
            };
            return error && messages[error.code] || 'The TV could not complete the input request. Select Refresh to check its inputs.';
        };
        return api;
    }
    return {create:create};
}));

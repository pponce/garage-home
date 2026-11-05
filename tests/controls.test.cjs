'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Controls = require('../launcher/vetro-controls');
const SDK = require('../launcher/vetro-access-client');
function storage() {
    const data = {};
    return {getItem:k=>data[k] === undefined ? null : data[k],setItem:(k,v)=>{data[k]=String(v);}};
}
function fixture(handler) {
    const calls = [], preferences = storage();
    const api = Controls.create({storage:preferences,start:()=>Promise.resolve(),client:()=>({
        call:async (method,params)=>{calls.push({method,params});return handler(method,params);}
    })});
    return {api,calls,preferences};
}
test('initial request includes only selected controls, with brightness explicitly opt-in and persisted', async ()=>{
    const f = fixture((method,params)=>({state:'pending',scopes:params.scopes}));
    assert.equal(f.api.brightnessEnabled(),false);
    await f.api.connect();
    assert.deepEqual(f.calls[0].params.scopes,['tasks.read','tasks.stop','remote.audio','power.off']);
    f.api.setBrightnessEnabled(true);
    await f.api.connect();
    assert.ok(f.calls[1].params.scopes.includes('picture.brightness'));
    f.api.setBrightnessEnabled(false);
    await f.api.connect();
    assert.ok(!f.calls[2].params.scopes.includes('picture.brightness'));
    assert.ok(!f.calls.some(c=>c.params.scopes.includes('remote.playback')));
});
test('partial approvals are preserved without assuming stop or power access', async ()=>{
    const f = fixture(()=>({state:'approved',scopes:['tasks.read']}));
    await f.api.refresh();
    assert.deepEqual(f.api.scopes,['tasks.read']);
});
test('paused or revoked access refuses mutations with no fallback or repeat', async ()=>{
    for (const code of ['disabled','permission_denied','identity_changed']) {
        const f = fixture(()=>{throw Object.assign(Error('denied'),{code,submitted:false});});
        await assert.rejects(f.api.audio('XF86AudioMute'),e=>e.code===code);
        assert.equal(f.calls.length,1);
        assert.deepEqual(f.api.scopes,[]);
    }
});
test('unknown audio outcome sends one key and never retries', async ()=>{
    const f = fixture(()=>{throw Object.assign(Error('lost'),{code:'timeout',submitted:null});});
    await assert.rejects(f.api.audio('XF86AudioRaiseVolume'));
    assert.equal(f.calls.length,1);
    await assert.rejects(f.api.audio('XF86Home'));
    await assert.rejects(f.api.audio('XF86AudioPlay'));
    assert.equal(f.calls.length,1);
});
test('rapid duplicate presses do not queue more mutations', async ()=>{
    let finish;
    const f = fixture(()=>new Promise(resolve=>{finish=resolve;}));
    const first = f.api.audio('XF86AudioMute');
    await assert.rejects(f.api.audio('XF86AudioMute'),e=>e.code==='busy');
    await new Promise(resolve=>setImmediate(resolve));
    finish({ok:true,submitted:true});
    await first;
    assert.equal(f.calls.length,1);
});
test('a cancelled shutdown cannot dispatch after waiting for the reply service', async ()=>{
    let ready, wanted=true, calls=0;
    const api=Controls.create({storage:storage(),start:()=>new Promise(resolve=>{ready=resolve;}),
        client:()=>({call:async()=>{calls++;return {ok:true,submitted:true};}})});
    const pending=api.powerOff(()=>wanted);
    await new Promise(resolve=>setImmediate(resolve));
    wanted=false;
    ready();
    await assert.rejects(pending,e=>e.code==='cancelled' && e.submitted===false);
    assert.equal(calls,0);
});
test('task pages are joined and the launcher is excluded without exposing raw processes', async ()=>{
    const rows = Array.from({length:20},(_,i)=>({appId:i===0?'GarageHome.launcher':'User.app'+i,
        name:'App '+i,running:true,memoryBytes:100}));
    const f = fixture((method,p)=>p.offset===0?{apps:rows,nextOffset:20}:{apps:[{
        appId:'User.final',name:'Final',running:true,memoryBytes:null}],nextOffset:null});
    const result = await f.api.tasks();
    assert.equal(result.length,20);
    assert.ok(!result.some(a=>a.appId==='GarageHome.launcher'));
    assert.deepEqual(f.calls.map(c=>c.params.offset),[0,20]);
});
test('invalid task cursors stop pagination and an unverified stop never reports success', async ()=>{
    const f = fixture(()=>({apps:[],nextOffset:0}));
    await assert.rejects(f.api.tasks());
    assert.equal(f.calls.length,1);
    const g = fixture(()=>({ok:false,verified:false,appId:'User.app'}));
    await assert.rejects(g.api.stop('User.app'),e=>e.code==='not_confirmed' && e.submitted===null);
    await assert.rejects(g.api.stop('GarageHome.launcher'));
    assert.equal(g.calls.length,1);
});
test('a close succeeds only for the exact app with verified stop', async ()=>{
    const f = fixture((m,p)=>({ok:true,verified:true,appId:p.appId}));
    assert.equal((await f.api.stop('User.app')).verified,true);
});
test('brightness is never read or changed while disabled', async ()=>{
    const f = fixture(()=>{throw Error('must not call');});
    await assert.rejects(f.api.brightness(5),e=>e.code==='brightness_off');
    assert.equal(f.calls.length,0);
});
test('brightness reads fresh bounds, clamps the value and sends expected-current-value', async ()=>{
    const f = fixture((method,p)=>method==='brightness.read'?{value:48,min:0,max:50}:
        {ok:true,verified:true,value:p.value});
    f.api.setBrightnessEnabled(true);
    assert.equal(await f.api.brightness(5),50);
    assert.deepEqual(f.calls[1],{method:'brightness.set',params:{value:50,expected:48}});
});
test('turning brightness off while its read is pending prevents the write', async ()=>{
    let finish;
    const f = fixture(()=>new Promise(resolve=>{finish=resolve;}));
    f.api.setBrightnessEnabled(true);
    const work = f.api.brightness(-5);
    await new Promise(resolve=>setImmediate(resolve));
    f.api.setBrightnessEnabled(false);
    finish({value:30,min:0,max:50});
    await assert.rejects(work,e=>e.code==='brightness_off');
    assert.equal(f.calls.length,1);
});
test('changed picture value and lost power replies are not retried', async ()=>{
    for (const method of ['brightness','powerOff']) {
        const f = fixture(m=>{
            if(m==='brightness.read')return {value:25,min:0,max:50};
            throw Object.assign(Error('not confirmed'),{code:'not_confirmed',submitted:null});
        });
        f.api.setBrightnessEnabled(true);
        await assert.rejects(method === 'brightness' ? f.api.brightness(-5) : f.api.powerOff());
        assert.equal(f.calls.filter(c=>c.method.endsWith('.set')||c.method==='power.off').length,1);
    }
});
test('real SDK authenticates signed HTTP replies; tampering cannot cause a repeated command',async ()=>{
    for(const tamper of [false,true]) {
        let message, sent=0;
        const client = new SDK({httpReplies:true,crypto:crypto.webcrypto,tizen:{messageport:{
            requestLocalMessagePort:()=>({addMessagePortListener:()=>1,removeMessagePortListener:()=>{}}),
            requestRemoteMessagePort:(app,port)=>{
                assert.equal(app,'vetrotvapp.svc');assert.equal(port,'VETRO_APP_ACCESS_V1');
                return {sendMessage:data=>{sent++;message=JSON.parse(data[0].value);}};
            }
        }},pollReply:async id=>{
            assert.equal(id,message.reply.id);
            const body = JSON.stringify({version:2,id:message.id,ok:true,result:{ok:true,submitted:true}});
            const mac = crypto.createHmac('sha256',Buffer.from(message.reply.key,'hex'))
                .update('VETRO_APP_REPLY_V2\n'+id+'\n'+body).digest('hex');
            return {status:200,body:{body:tamper?body.replace('"ok":true','"ok":false'):body,mac}};
        }});
        try{
            if(tamper)await assert.rejects(client.call('audio.key',{key:'XF86AudioMute'}),e=>e.code==='invalid_reply');
            else assert.equal((await client.call('audio.key',{key:'XF86AudioMute'})).submitted,true);
            assert.equal(sent,1);
        }finally{client.close();}
    }
});

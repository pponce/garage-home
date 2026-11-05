'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Sleep = require('../launcher/sleep-timer');
function fixture() {
    let raw=null,time=100000,sequence=0;
    const removed=[],alarms=[];
    const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;}};
    const tizen={
        AlarmRelative:function (seconds){this.seconds=seconds;},
        ApplicationControl:function (op,a,b,c,data){this.data=data;},
        ApplicationControlData:function (key,value){this.key=key;this.value=value;},
        alarm:{add:(alarm,app,control)=>{alarm.id='alarm'+(++sequence);alarms.push({alarm,app,control});},
            remove:id=>removed.push(id)}
    };
    const api=Sleep.create({storage,tizen,crypto:crypto.webcrypto,now:()=>time});
    return {api,alarms,removed,storage,tizen,advance:ms=>{time+=ms;}};
}
test('sleep only schedules an explicit supported timer',()=>{
    const f=fixture();
    assert.equal(f.api.state(),null);
    assert.throws(()=>f.api.schedule(1));
    const result=f.api.schedule(15);
    assert.equal(f.alarms[0].app,'GarageHome.launcher');
    assert.equal(f.alarms[0].alarm.seconds,900);
    assert.equal(result.at,100000+900000);
});
test('early, mismatched and repeated alarm callbacks cannot consume the timer',()=>{
    const f=fixture();f.api.schedule(15);
    const data=f.alarms[0].control.data;
    assert.equal(f.api.consume(data),false);
    f.advance(900000);
    assert.equal(f.api.consume([{key:'action',value:['sleep']},{key:'sleepToken',value:['b'.repeat(32)]}]),false);
    assert.equal(f.api.consume(data),true);
    assert.equal(f.api.consume(data),false);
});
test('cancelled and superseded alarms cannot shut down later',()=>{
    const f=fixture();f.api.schedule(15);
    const first=f.alarms[0].control.data;
    f.api.schedule(30);
    assert.deepEqual(f.removed,['alarm1']);
    f.advance(900000);
    assert.equal(f.api.consume(first),false);
    const second=f.alarms[1].control.data;
    f.api.cancel();f.advance(900000);
    assert.equal(f.api.consume(second),false);
    assert.equal(f.api.state(),null);
});
test('late alarm and old timer format are ignored',()=>{
    const f=fixture();f.api.schedule(15);
    f.advance(900000+120001);
    assert.equal(f.api.consume(f.alarms[0].control.data),false);
    f.storage.setItem('gh.sleep',JSON.stringify({id:'legacy',at:999999999}));
    assert.equal(f.api.state(),null);
});
test('failed persistence removes the new alarm and keeps the previous valid timer',()=>{
    const f=fixture();const previous=f.api.schedule(15);
    f.storage.setItem=()=>{throw Error('full');};
    assert.throws(()=>f.api.schedule(30));
    assert.equal(f.api.state().id,previous.id);
    assert.deepEqual(f.removed,['alarm2']);
});

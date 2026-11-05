'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const Sources = require('../launcher/tv-sources');

function fixture(options={}) {
    const calls=[], one={type:'HDMI',number:1}, two={type:'HDMI',number:2}, tv={type:'TV',number:0};
    let current=one, report={connected:[two,one,tv],disconnected:[{type:'HDMI',number:3}]};
    const tz={systeminfo:{getPropertyValue:(name,done)=>{calls.push({op:'read',name});done(report);}},
        tvwindow:{getSource:()=>current,setSource:(source,done,fail,window)=>{
            calls.push({op:'switch',source,window});current=source;done(source,'MAIN');
        }},application:{launch:(id,done)=>{calls.push({op:'launch',id});done();},
            launchAppControl:(control,id,done)=>{calls.push({op:'appcontrol',id,control});done();}},
        ApplicationControl:function(operation){this.operation=operation;}};
    const api=Sources.create({tizen:tz,...options});
    return {api,tz,calls,one,two,tv,setReport:value=>{report=value;},setCurrent:value=>{current=value;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('listing inputs does not switch or launch and preserves reported connection state',async()=>{
    const f=fixture();
    assert.deepEqual(f.calls,[]);
    f.setReport({connected:[f.two,f.one,f.tv,{type:'COMP',number:1}],disconnected:[f.two,{type:'HDMI',number:3}]});
    const rows=await f.api.list();
    assert.deepEqual(rows.map(s=>s.id),['HDMI:1','HDMI:2','HDMI:3','TV:0']);
    assert.equal(rows[0].current,true);
    assert.equal(rows[1].connected,true);
    assert.equal(rows[2].connected,false);
    assert.equal(rows[3].label,'Live TV');
    assert.deepEqual(f.calls.map(c=>c.op),['read']);
});
test('source selection re-reads the list and uses the exact reported source before opening the viewer',async()=>{
    const f=fixture();
    await f.api.list();
    const fresh={type:'HDMI',number:2,signal:false};
    f.setReport({connected:[fresh],disconnected:[]});
    const result=await f.api.select('HDMI:2');
    assert.equal(result.source.id,'HDMI:2');
    assert.equal(result.viewerSubmitted,true);
    assert.deepEqual(f.calls.map(c=>c.op),['read','read','switch','launch']);
    assert.equal(f.calls[2].source,fresh);
    assert.equal(f.calls[2].window,'MAIN');
    assert.equal(f.calls[3].id,'org.tizen.tv-viewer');
});
test('reported disconnected ports can be selected without inventing missing ports',async()=>{
    const f=fixture();
    assert.equal((await f.api.select('HDMI:3')).viewerSubmitted,true);
    await assert.rejects(f.api.select('HDMI:4'),e=>e.code==='missing');
    assert.equal(f.calls.filter(c=>c.op==='switch').length,1);
});
test('a port removed since listing is refused before any switch',async()=>{
    const f=fixture();await f.api.list();
    f.setReport({connected:[f.one],disconnected:[]});
    await assert.rejects(f.api.select('HDMI:2'),e=>e.code==='missing');
    assert.ok(!f.calls.some(c=>c.op==='switch'||c.op==='launch'));
});
test('unavailable API and malformed source reports cause no mutations',async()=>{
    await assert.rejects(Sources.create({}).list(),e=>e.code==='unavailable');
    const f=fixture();f.setReport({connected:'HDMI 1',disconnected:[]});
    await assert.rejects(f.api.select('HDMI:1'),e=>e.code==='unavailable');
    assert.deepEqual(f.calls.map(c=>c.op),['read']);
});
test('a mismatched readback does not launch the viewer or repeat input selection',async()=>{
    const f=fixture();
    f.tz.tvwindow.setSource=(source,done)=>{f.calls.push({op:'switch'});done(source);};
    await assert.rejects(f.api.select('HDMI:2'),e=>e.code==='not_confirmed');
    assert.deepEqual(f.calls.map(c=>c.op),['read','switch']);
});
test('the native success callback confirms selection when current-source readback is unavailable',async()=>{
    const f=fixture();f.tz.tvwindow.getSource=()=>{throw Error('readback unavailable');};
    assert.equal((await f.api.select('TV:0')).viewerSubmitted,true);
    assert.equal(f.calls.filter(c=>c.op==='switch').length,1);
});
test('closing the list while its fresh read is pending prevents the switch',async()=>{
    const f=fixture();let finish,wanted=true;
    f.tz.systeminfo.getPropertyValue=(name,done)=>{finish=done;};
    const work=f.api.select('HDMI:1',()=>wanted);
    wanted=false;finish({connected:[f.one],disconnected:[]});
    await assert.rejects(work,e=>e.code==='cancelled');
    assert.deepEqual(f.calls,[]);
});
test('leaving after dispatch suppresses a late viewer launch',async()=>{
    const f=fixture();let finish,wanted=true;
    f.tz.tvwindow.setSource=(source,done)=>{f.calls.push({op:'switch'});finish=()=>done(source);};
    const work=f.api.select('HDMI:1',()=>wanted);await tick();
    wanted=false;finish();
    await assert.rejects(work,e=>e.code==='cancelled');
    assert.deepEqual(f.calls.map(c=>c.op),['read','switch']);
});
test('rapid repeated selections do not queue input changes',async()=>{
    const f=fixture();let finish;
    f.tz.tvwindow.setSource=(source,done)=>{f.calls.push({op:'switch'});finish=()=>done(source);};
    const work=f.api.select('HDMI:1');
    await assert.rejects(f.api.select('HDMI:2'),e=>e.code==='busy');
    await tick();finish();await work;
    assert.equal(f.calls.filter(c=>c.op==='switch').length,1);
});
test('ambiguous switch timeouts ignore late replies and never launch a viewer',async()=>{
    const f=fixture({timeoutMs:15});let finish;
    f.tz.tvwindow.setSource=(source,done)=>{f.calls.push({op:'switch'});finish=()=>done(source);};
    await assert.rejects(f.api.select('HDMI:1'),e=>e.code==='not_confirmed');
    finish();await tick();
    assert.deepEqual(f.calls.map(c=>c.op),['read','switch']);
});
test('an explicit viewer launch refusal can use the public app-control launch once',async()=>{
    const f=fixture();
    f.tz.application.launch=(id,done,fail)=>{f.calls.push({op:'launch'});fail(Error('refused'));};
    assert.equal((await f.api.select('HDMI:1')).viewerSubmitted,true);
    assert.deepEqual(f.calls.map(c=>c.op),['read','switch','launch','appcontrol']);
});
test('ambiguous viewer launch timeouts are reported without a second launch or switch',async()=>{
    const f=fixture({timeoutMs:15});
    f.tz.application.launch=()=>{f.calls.push({op:'launch'});};
    const result=await f.api.select('HDMI:1');
    assert.equal(result.source.current,true);
    assert.equal(result.viewerSubmitted,false);
    assert.deepEqual(f.calls.map(c=>c.op),['read','switch','launch']);
});
test('a failed viewer launch never uses a fallback after the user leaves',async()=>{
    const f=fixture();let wanted=true;
    f.tz.application.launch=(id,done,fail)=>{f.calls.push({op:'launch'});wanted=false;fail(Error('refused'));};
    assert.equal((await f.api.select('HDMI:1',()=>wanted)).viewerSubmitted,false);
    assert.deepEqual(f.calls.map(c=>c.op),['read','switch','launch']);
});

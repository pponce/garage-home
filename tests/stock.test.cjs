'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');const {create}=require('../launcher/service/vetro-stock');
const app={appId:'user.App',name:'App',show:true,system:false,removable:true,disabled:false};
test('stock filters, verifies, and does not retry uncertain operations',async()=>{
 let posts=0,fail=false,brightness={id:'backlight',value:20,min:0,max:50,writable:true,probe:'confirmed'};const calls=[];
 const client=create({addresses:()=>[],request:async(host,path,body)=>{
 calls.push([path,body]);if(body){posts++;if(fail)throw Object.assign(Error('lost'),{submitted:null});}
 if(path==='/status')return {agent:{connected:true}};
 if(path==='/apps?refresh=1')return {apps:[app,{...app,appId:'system.App',system:true},{...app,appId:'GarageHome.launcher'},{...app,appId:'hidden.App',show:false}]};
 if(path.startsWith('/monitor'))return {processes:[{appId:'user.App',rssBytes:10},{appId:'user.App',rssBytes:20},{appId:'system.App',rssBytes:100}]};
 if(path==='/components/action')return {ok:true,verified:true,appId:body.appId};if(path==='/control')return {ok:true,key:body.key,exit_code:0};
 if(path==='/tv-settings')return body?{ok:true,verified:true,value:body.value}:{items:[brightness]};}});
 await assert.rejects(client.call('audio.key',{key:'XF86AudioMute'}));assert.equal(posts,0);await client.call('access.status',{});
 const list=await client.call('tasks.list',{offset:0,limit:20});assert.deepEqual(list.apps.map(a=>[a.appId,a.memoryBytes]),[['user.App',30]]);
 await assert.rejects(client.call('tasks.stop',{appId:'system.App'}));assert.equal(posts,0);assert.equal((await client.call('tasks.stop',{appId:'user.App'})).verified,true);
 await assert.rejects(client.call('audio.key',{key:'XF86PowerOff'}));await assert.rejects(client.call('exec',{command:'anything'}));
 await assert.rejects(client.call('brightness.set',{value:21,expected:19}));brightness.probe=null;await assert.rejects(client.call('brightness.read',{}));brightness.probe='confirmed';
 assert.equal((await client.call('brightness.set',{value:21,expected:20})).value,21);fail=true;const before=posts;await assert.rejects(client.call('power.off',{}));assert.equal(posts,before+1);
});
test('stock HTTP route retains key/origin validation and body limits',async()=>{
 const key='a'.repeat(64),calls=[];const service=require('../launcher/service/server').create({key,port:0,stock:{call:async(m,p)=>{calls.push([m,p]);return {ok:true};}}});
 await new Promise((r,j)=>service.start(e=>e?j(e):r()));const port=service.address().port;
 function send(body,extra={}){return new Promise((r,j)=>{const req=http.request({hostname:'127.0.0.1',port,path:'/stock',method:'POST',headers:{'X-Garage-Key':key,'Content-Type':'application/json',Origin:'null',...extra}},res=>{res.resume();res.on('end',()=>r(res.statusCode));});req.on('error',j);req.end(body);});}
 try{assert.equal(await send(JSON.stringify({method:'access.status',params:{}})),200);assert.equal(calls.length,1);assert.equal(await send('{}',{'X-Garage-Key':'wrong'}),403);
 assert.equal(await send('{}',{Origin:'https://evil.example'}),403);assert.equal(await send('x'.repeat(2049)),413);assert.equal(await send('{}'),400);assert.equal(calls.length,1);
 }finally{await new Promise(r=>service.stop(r));}
});

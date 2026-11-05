'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {create}=require('../launcher/service/server');
test('local reader requires its key, exact host, allowed origin and read-only paths',async ()=>{
    const ids=[],key='a'.repeat(64),id='b'.repeat(64);
    const service=create({key,port:0,reader:async value=>{ids.push(value);return {status:202,body:null};}});
    await new Promise((resolve,reject)=>service.start(e=>e?reject(e):resolve()));
    const port=service.address().port;
    function request(url,extra={},method='GET'){
        return new Promise((resolve,reject)=>{
            const req=http.request({hostname:'127.0.0.1',port,path:url,method,
                headers:{'X-Garage-Key':key,Origin:'null',...extra}},res=>{
                let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));
            });req.on('error',reject);req.end();
        });
    }
    try{
        assert.equal((await request('/health')).status,200);
        assert.equal((await request('/replies/'+id)).status,202);
        assert.deepEqual(ids,[id]);
        for(const [path,headers,method,status] of [
            ['/health',{'X-Garage-Key':'wrong'},'GET',403],
            ['/health',{Host:'evil.test'},'GET',403],
            ['/health',{Origin:'https://evil.test'},'GET',403],
            ['/exec',{},'POST',405],
            ['/replies/'+id+'?url=http://elsewhere',{},'GET',404],
            ['/replies/../health',{},'GET',404],
            ['/local-key.js',{},'GET',404],
            ['/apps/launch',{},'GET',404]
        ]) assert.equal((await request(path,headers,method)).status,status,path);
        const preflight=await request('/health',{'X-Garage-Key':'','Access-Control-Request-Method':'GET',
            'Access-Control-Request-Headers':'x-garage-key'},'OPTIONS');
        assert.equal(preflight.status,204);
        assert.equal(preflight.headers['access-control-allow-headers'],'X-Garage-Key');
        assert.deepEqual(ids,[id]);
    }finally{await new Promise(resolve=>service.stop(resolve));}
});

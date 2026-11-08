// Narrow adapter for stock Vetro. Callers cannot choose hosts, paths or shell commands.
'use strict';
var http=require('http'),addresses=require('./local-addresses');
var ID=/^[A-Za-z0-9_.-]{1,120}$/;
function fault(message){var e=Error(message);e.code='unavailable';e.submitted=false;return e;}
function request(address,route,body){return new Promise(function(resolve,reject){
  var req,done=false,mutating=body!==undefined,timer=setTimeout(function(){finish(fault('Vetro timed out'));},60000);
  function finish(e,d){if(done)return;done=true;clearTimeout(timer);if(e){if(mutating)e.submitted=null;reject(e);if(req)req.destroy();}else resolve(d);}
  try{var payload=mutating?JSON.stringify(body):null,headers={Accept:'application/json',Connection:'close'};
    if(payload){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(payload);}
    req=http.request({hostname:address,localAddress:address,family:4,port:8099,path:route,method:mutating?'POST':'GET',headers:headers,agent:false},function(res){
      var chunks=[],size=0;res.on('data',function(b){size+=b.length;if(size>2*1024*1024)return finish(fault('Vetro response too large'));chunks.push(b);});
      res.on('error',finish);res.on('aborted',function(){finish(fault('Vetro response interrupted'));});
      res.on('end',function(){if(done)return;try{var d=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode!==200||d.ok===false)throw fault('Vetro did not confirm the command');finish(null,d);}catch(e){finish(e);}});
    });req.on('error',finish);req.end(payload);
  }catch(e){finish(e);}
});}
function eligible(a){return a&&typeof a.appId==='string'&&ID.test(a.appId)&&a.show===true&&a.system===false&&a.removable===true&&a.disabled===false&&!a.protected&&!a.launchRisk&&
  a.appId!=='GarageHome.launcher'&&!/^GarageHome(?:\.|$)|^vetrotvapp(?:\.|$)/.test(a.appId);}
function create(options){options=options||{};var get=options.request||request,local=options.addresses||addresses.localLanAddresses,address=null,busy=false;
  function discover(){var choices=['127.0.0.1'].concat(local()),i=0;
    function next(){var host=choices[i++];return get(host,'/status').then(function(s){if(!s.agent||s.agent.connected!==true)throw fault('Open Vetro and connect root first');address=host;return s;}).catch(function(e){
      if(i<choices.length&&['EHOSTUNREACH','ENETUNREACH','EACCES','EPERM'].indexOf(e.code)>=0)return next();throw e;});}return next();}
  function send(route,body){if(!address||address!=='127.0.0.1'&&local().indexOf(address)<0)return Promise.reject(fault('Connect to Vetro first'));return get(address,route,body);}
  function inventory(){return send('/apps?refresh=1').then(function(d){if(d.registryError||!Array.isArray(d.apps)||d.apps.length>2000)throw fault('App registry unavailable');return d.apps.filter(eligible);});}
  function tasks(){return Promise.all([inventory(),send('/monitor?scope=full&refresh=1')]).then(function(both){
    if(!Array.isArray(both[1].processes))throw fault('Running apps unavailable');
    return both[0].map(function(a){var procs=both[1].processes.filter(function(p){return p.appId===a.appId;});return procs.length?{appId:a.appId,name:a.name||a.appId,running:true,memoryBytes:procs.reduce(function(n,p){return n+(Number.isFinite(p.rssBytes)&&p.rssBytes>=0?p.rssBytes:0);},0)}:null;}).filter(Boolean).slice(0,200);
  });}
  function brightness(){return send('/tv-settings').then(function(d){var a=(d.items||[]).find(function(x){return x.id==='backlight';});
    if(!a||a.probe!=='confirmed'||a.writable!==true||a.error||!Number.isInteger(a.value)||!Number.isInteger(a.min)||!Number.isInteger(a.max)||a.value<a.min||a.value>a.max)throw fault('This TV has not confirmed panel brightness support');return a;});}
  function perform(method,p){
    if(method==='access.status'||method==='access.request')return discover().then(function(){return {state:'approved',scopes:['tasks.read','tasks.stop','remote.audio','power.off','picture.brightness'],transport:'stock'};});
    if(method==='tasks.list'){
      if(!Number.isInteger(p.offset)||p.offset<0||p.offset>180||p.offset%20||p.limit!==20)throw fault('Invalid app cursor');
      // One snapshot for the complete paginated read.
      return (p.offset===0?tasks().then(function(a){api.snapshot=a;return a;}):Promise.resolve(api.snapshot)).then(function(a){if(!a)throw fault('Refresh running apps');var end=p.offset+20;return {apps:a.slice(p.offset,end),nextOffset:end<a.length?end:null};});
    }
    if(method==='tasks.stop'){
      if(!ID.test(p.appId))throw fault('Invalid app');
      return inventory().then(function(a){if(!a.some(function(x){return x.appId===p.appId;}))throw fault('Only removable user apps can be closed');return send('/components/action',{action:'stop',appId:p.appId});}).then(function(r){if(r.ok!==true||r.verified!==true||r.appId!==p.appId)throw fault('App close was not confirmed');return r;});
    }
    if(method==='audio.key'||method==='power.off'){
      var key=method==='power.off'?'XF86PowerOff':p.key;
      if(['XF86AudioLowerVolume','XF86AudioRaiseVolume','XF86AudioMute','XF86PowerOff'].indexOf(key)<0||method==='audio.key'&&key==='XF86PowerOff')throw fault('Unsupported control');
      return send('/control',{key:key}).then(function(r){if(r.ok!==true||r.key!==key||r.exit_code!==0)throw fault('TV command was not confirmed');return {ok:true,submitted:true};});
    }
    if(method==='brightness.read')return brightness();
    if(method==='brightness.set')return brightness().then(function(a){if(!Number.isInteger(p.value)||p.value<a.min||p.value>a.max||p.expected!==a.value)throw fault('Refresh brightness before changing it');return send('/tv-settings',{id:'backlight',value:p.value,expected:p.expected});});
    throw fault('Unsupported control');
  }
  var api={call:function(method,p){if(busy)return Promise.reject(fault('A Vetro control is pending'));busy=true;
    return Promise.resolve().then(function(){return perform(method,p||{});}).then(function(r){busy=false;return r;},function(e){busy=false;throw e;});}};return api;
}
module.exports={create:create,eligible:eligible};

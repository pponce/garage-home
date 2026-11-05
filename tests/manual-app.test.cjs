'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../launcher');
let server, browser, address;

before(async () => {
  server = http.createServer((req, res) => {
    const relative = new URL(req.url, 'http://localhost').pathname;
    if (relative === '/garage-config.js') { res.end('window.GARAGE_CONFIG = {};'); return; }
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.GARAGE_CHROMIUM || undefined });
});

async function mockControls(page) {
  await page.evaluate(() => {
    window.vetroCalls = [];
    window.grants = ['tasks.read','tasks.stop','remote.audio','power.off'];
    window.stopResult = 'verified';
    window.muted = false;
    window.alarmCalls = [];
    window.removedAlarms = [];
    window.sleepRequest = null;
    window.GarageVetroTransport = {start:()=>Promise.resolve(),readReply:()=>Promise.reject()};
    window.VetroAppAccess = function () {
      this.call = async (method,params) => {
        window.vetroCalls.push({method,params});
        if(method === 'access.request') return {state:'pending',scopes:[]};
        if(method === 'access.status') return {state:'approved',scopes:window.grants};
        const needed = {'audio.key':'remote.audio','tasks.list':'tasks.read','tasks.stop':'tasks.stop',
          'power.off':'power.off','brightness.read':'picture.brightness','brightness.set':'picture.brightness'};
        if(!window.grants.includes(needed[method])) throw Object.assign(new Error('denied'),{code:'permission_denied',submitted:false});
        if(method === 'tasks.list') return {apps:[{appId:'SampleApp1.Sample',name:'Sample App',
          running:true,memoryBytes:10485760}],nextOffset:null};
        if(method === 'tasks.stop') return {appId:params.appId,verified:window.stopResult==='verified',ok:window.stopResult==='verified'};
        if(method === 'brightness.read') return {value:20,min:0,max:50};
        if(method === 'brightness.set') return {ok:true,verified:true,value:params.value};
        return {ok:true,submitted:true};
      };
    };
    window.tizen.AlarmRelative = function(seconds){this.seconds=seconds;};
    window.tizen.ApplicationControl = function(op,a,b,c,data){this.data=data;};
    window.tizen.ApplicationControlData = function(key,value){this.key=key;this.value=value;};
    window.tizen.alarm = {
      add(alarm,app,ctrl){alarm.id='alarm'+(window.alarmCalls.length+1);window.alarmCalls.push({id:alarm.id,app,data:ctrl.data});},
      remove(id){window.removedAlarms.push(id);}
    };
    const original = window.tizen.application.getCurrentApplication;
    window.tizen.application.getCurrentApplication = () => ({
      ...original(), getRequestedAppControl:()=>window.sleepRequest
    });
  });
}
async function activateControl(page, name) {
  await page.waitForSelector('#splash.gone');
  for(let i=0;i<7 && !await page.locator('#ctrlRow .focused').count();i++) await page.keyboard.press('ArrowDown');
  const index = await page.locator('#ctrlRow [data-control]').evaluateAll((items,name)=>items.findIndex(x=>x.dataset.control===name),name);
  assert.ok(index>=0,'control '+name+' is present');
  for(let i=0;i<12;i++) await page.keyboard.press('ArrowLeft');
  for(let i=0;i<index;i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
}
async function assertSheetFits(page) {
  const box=await page.locator('#modal .sheet').boundingBox();
  assert.ok(box && box.x>=60 && box.y>=60 && box.x+box.width<=1860 && box.y+box.height<=1020,
    'the controls sheet fits within the TV screen margins');
}
test('remote control settings request only base permissions and brightness requires an explicit opt-in',async()=>{
  const {page,errors}=await openApp(false);
  try{
    await mockControls(page);
    assert.equal(await page.locator('[data-control="dim"]').count(),0);
    assert.equal(await page.locator('[data-control="bright"]').count(),0);
    await activateControl(page,'settings');
    await assertSheetFits(page);
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.vetroCalls.some(c=>c.method==='access.request'));
    assert.deepEqual(await page.evaluate(()=>window.vetroCalls[0].params.scopes),['tasks.read','tasks.stop','remote.audio','power.off']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#modal').innerText(),/Filmmaker Mode/);
    await assertSheetFits(page);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-control="dim"]').count(),1);
    assert.equal(await page.evaluate(()=>localStorage.getItem('gh.tvBrightness')),'true');
    assert.equal(await page.evaluate(()=>window.vetroCalls.filter(c=>c.method.startsWith('brightness.')).length),0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.vetroCalls.filter(c=>c.method==='access.request').length===2);
    assert.ok(await page.evaluate(()=>window.vetroCalls[1].params.scopes.includes('picture.brightness')));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-control="dim"]').count(),0);
    fs.mkdirSync(path.join(root,'../test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'../test-results/vetro-controls.png')});
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('mute uses scoped audio and running apps require confirmed close before a success message',async()=>{
  const {page,errors}=await openApp(false);
  try{
    await mockControls(page);
    await activateControl(page,'mute');
    await page.waitForFunction(()=>window.vetroCalls.some(c=>c.method==='audio.key'));
    assert.equal(await page.evaluate(()=>window.vetroCalls[0].params.key),'XF86AudioMute');
    await activateControl(page,'tasks');
    await page.waitForSelector('#taskList .m-item');
    assert.match(await page.locator('#taskList').innerText(),/Sample App.*10 MB/s);
    await page.keyboard.press('Enter');
    await page.evaluate(()=>{window.stopResult='unconfirmed';});
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('may still'));
    assert.equal(await page.evaluate(()=>window.vetroCalls.filter(c=>c.method==='tasks.stop').length),1);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('sleep needs power permission; cancel and backgrounding prevent countdown shutdown',async()=>{
  const {page,errors}=await openApp(false,true);
  try{
    await mockControls(page);
    await page.clock.fastForward(2000);
    await page.evaluate(()=>{window.grants=['tasks.read'];});
    await activateControl(page,'sleep');
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('approve'));
    assert.equal(await page.evaluate(()=>window.alarmCalls.length),0);
    await page.evaluate(()=>{window.grants.push('power.off');});
    await activateControl(page,'sleep');
    await page.waitForFunction(()=>window.alarmCalls.length===1);
    await page.evaluate(()=>localStorage.setItem('gh.photos',JSON.stringify({at:Date.now(),list:[
      {url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',title:'Test image'}
    ]})));
    await page.clock.fastForward(15*60000);
    await page.waitForSelector('#ambient-mode.show');
    await page.evaluate(()=>{
      window.sleepRequest={appControl:{data:window.alarmCalls[0].data}};
      window.dispatchEvent(new Event('appcontrol'));
    });
    assert.match(await page.locator('#modal').innerText(),/Keep watching/);
    assert.equal(await page.locator('#ambient-mode.show').count(),0);
    await page.keyboard.press('Enter');
    await page.clock.fastForward(20000);
    assert.equal(await page.evaluate(()=>window.vetroCalls.filter(c=>c.method==='power.off').length),0);
    await activateControl(page,'sleep');
    await page.waitForFunction(()=>window.alarmCalls.length===2);
    await page.clock.fastForward(15*60000);
    await page.evaluate(()=>{
      window.sleepRequest={appControl:{data:window.alarmCalls[1].data}};
      window.dispatchEvent(new Event('appcontrol'));
      window.appHidden=true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(20000);
    assert.equal(await page.evaluate(()=>window.vetroCalls.filter(c=>c.method==='power.off').length),0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('a due sleep alarm sends standby once and cannot replay after another foreground event',async()=>{
  const {page,errors}=await openApp(false,true);
  try{
    await mockControls(page);
    await page.clock.fastForward(2000);
    await activateControl(page,'sleep');
    await page.waitForFunction(()=>window.alarmCalls.length===1);
    await page.clock.fastForward(15*60000);
    await page.evaluate(()=>{
      window.sleepRequest={appControl:{data:window.alarmCalls[0].data}};
      window.dispatchEvent(new Event('appcontrol'));
    });
    await page.clock.runFor(15000);
    await page.waitForFunction(()=>window.vetroCalls.some(c=>c.method==='power.off'));
    await page.evaluate(()=>{
      window.dispatchEvent(new Event('appcontrol'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(20000);
    assert.equal(await page.evaluate(()=>window.vetroCalls.filter(c=>c.method==='power.off').length),1);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

async function mockSources(page) {
  await page.evaluate(()=>{
    window.inputCalls=[];window.inputHold=false;window.inputReadError=false;window.viewerFails=false;
    window.pendingSourceReads=[];window.inputCurrent={type:'HDMI',number:2};
    window.inputInfo={connected:[{type:'HDMI',number:2},{type:'HDMI',number:1},{type:'TV',number:0}],
      disconnected:[{type:'HDMI',number:3},{type:'HDMI',number:4}]};
    window.WebSocket=function(){window.inputCalls.push({op:'websocket'});throw Error('Unexpected remote connection');};
    window.tizen.systeminfo={getPropertyValue:(name,done,fail)=>{
      window.inputCalls.push({op:'read',name});
      if(name!=='VIDEOSOURCE'||window.inputReadError){fail(Error('Input read unavailable'));return;}
      if(window.inputHold)window.pendingSourceReads.push(()=>done(window.inputInfo));
      else done(window.inputInfo);
    }};
    window.tizen.tvwindow={getSource:()=>window.inputCurrent,setSource:(source,done,fail,type)=>{
      window.inputCalls.push({op:'switch',source,type});window.inputCurrent=source;done(source,'MAIN');
    }};
    window.tizen.application.launch=(id,done,fail)=>{
      window.appCalls.push(id);
      if(window.viewerFails){fail(Error('Viewer refused'));return;}
      window.appHidden=true;document.dispatchEvent(new Event('visibilitychange'));done();
    };
    window.tizen.ApplicationControl=function(operation){this.operation=operation;};
    window.tizen.application.launchAppControl=(control,id,done,fail)=>{
      window.appCalls.push(id);fail(Error('Viewer refused'));
    };
  });
}
async function activateSources(page) {
  await page.waitForSelector('#splash.gone');
  for(let i=0;i<7&&!await page.locator('#tvRow .focused').count();i++)await page.keyboard.press('ArrowDown');
  assert.ok(await page.locator('#tvRow .focused').count());
  for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tvRow .focused').getAttribute('data-name'),'Sources');
  await page.keyboard.press('Enter');
}
test('Sources lists native inputs and the remote opens the selected input in the TV viewer',async()=>{
  const {page,errors}=await openApp(false);
  try{
    await mockControls(page);await mockSources(page);
    await activateSources(page);
    await page.waitForSelector('#sourceList [data-source="HDMI:4"]');
    assert.equal(await page.locator('#sourceList .m-item').count(),5);
    assert.equal(await page.locator('#sourceList .focused').getAttribute('data-source'),'HDMI:2');
    assert.match(await page.locator('[data-source="HDMI:3"]').innerText(),/No device detected/);
    await assertSheetFits(page);
    assert.deepEqual(await page.evaluate(()=>window.appCalls),[]);
    assert.deepEqual(await page.evaluate(()=>window.inputCalls.map(c=>c.op)),['read']);
    fs.mkdirSync(path.join(root,'../test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'../test-results/sources.png')});
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.appCalls.includes('org.tizen.tv-viewer'));
    assert.deepEqual(await page.evaluate(()=>window.inputCalls.map(c=>c.op)),['read','read','switch']);
    assert.equal(await page.evaluate(()=>window.inputCurrent.number),1);
    assert.equal(await page.locator('#modal.show').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.vetroCalls),[]);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('Back during the input recheck prevents a delayed source change',async()=>{
  const {page,errors}=await openApp(false);
  try{
    await mockSources(page);await activateSources(page);
    await page.waitForSelector('#sourceList .m-item');
    await page.evaluate(()=>{window.inputHold=true;});
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.pendingSourceReads.length===1);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.pendingSourceReads.splice(0).forEach(f=>f()));
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#modal.show').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.inputCalls.map(c=>c.op)),['read','read']);
    assert.deepEqual(await page.evaluate(()=>window.appCalls),[]);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('failed source reads keep Refresh available and do not switch inputs',async()=>{
  const {page,errors}=await openApp(false);
  try{
    await mockSources(page);
    await page.evaluate(()=>{window.inputReadError=true;});
    await activateSources(page);
    await page.waitForFunction(()=>document.getElementById('sourceNote').textContent.includes('could not'));
    assert.equal(await page.locator('#sourceList .m-item').count(),0);
    await page.evaluate(()=>{window.inputReadError=false;});
    await page.keyboard.press('Enter');
    await page.waitForSelector('#sourceList [data-source="TV:0"]');
    assert.ok(await page.evaluate(()=>window.inputCalls.every(c=>c.op==='read')));
    assert.deepEqual(await page.evaluate(()=>window.appCalls),[]);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('a refused TV viewer leaves an accurate selected-input message and no hidden fallback',async()=>{
  const {page,errors}=await openApp(false);
  try{
    await mockControls(page);await mockSources(page);
    await page.evaluate(()=>{window.viewerFails=true;});
    await activateSources(page);
    await page.waitForSelector('#sourceList .m-item');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.getElementById('sourceNote').textContent.includes('TV view could not be opened'));
    assert.equal(await page.locator('#sourceList [aria-current="true"]').getAttribute('data-source'),'HDMI:1');
    assert.deepEqual(await page.evaluate(()=>window.appCalls),['org.tizen.tv-viewer','org.tizen.tv-viewer']);
    assert.deepEqual(await page.evaluate(()=>window.vetroCalls),[]);
    assert.deepEqual(await page.evaluate(()=>window.inputCalls.map(c=>c.op)),['read','read','switch']);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openApp(hidden, simulatedClock) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(10000);
  if (simulatedClock) await page.clock.install();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(address + '/') ? route.continue() : route.abort());
  await page.addInitScript(hidden => {
    window.appCalls = [];
    window.appHidden = hidden;
    Object.defineProperty(document, 'hidden', { get: () => window.appHidden });
    window.fetch = () => Promise.reject(new Error('External services unavailable'));
    window.tizen = { application: {
      getAppsInfo(done) { done([{ id: 'SampleApp1.Sample', name: 'Sample App', show: true, iconPath: '' }]); },
      getCurrentApplication() { return { appInfo: { id: 'GarageHome.launcher' },
        getRequestedAppControl() { return null; }, hide() { window.appCalls.push('hide'); } }; },
      launch(id, done) { window.appCalls.push(id); if (done) done(); },
      launchAppControl(control, id) { window.appCalls.push(id || 'appcontrol'); }
    } };
  }, hidden);
  await page.goto(address);
  await page.waitForSelector('#appsRow [data-launch="SampleApp1.Sample"]', { state: 'attached' });
  return { page, errors };
}

test('hidden startup and foreground changes never launch Garage Home or Vetro', async () => {
  const { page, errors } = await openApp(true);
  try {
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.appHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.appCalls), []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a selected app opens normally and Back can leave without restarting the dashboard', async () => {
  const { page, errors } = await openApp(false);
  try {
    await page.waitForSelector('#splash.gone');
    // The TV UI activates its focused tile with the remote's OK key; it has no mouse handler.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.appCalls), ['SampleApp1.Sample']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const calls = await page.evaluate(() => window.appCalls);
    assert.ok(calls.includes('hide'));
    assert.ok(!calls.includes('GarageHome.launcher') && !calls.some(id => id.startsWith('vetrotvapp')));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

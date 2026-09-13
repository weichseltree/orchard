// Execute the actual dashboard script with a small DOM and mocked HTTP boundary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../orchard/dashboard/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nrefresh\(\);\s*$/, '');
function page(fetch = async () => ({ok:true, json:async () => ({})})) {
  const elements = new Map(), events = {}, calls = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent:'', innerHTML:'', disabled:false, handlers:{},
      addEventListener(event, handler) { this.handlers[event] = handler; },
    });
    return elements.get(selector);
  };
  const context = vm.createContext({
    URL, Date, FormData:class { constructor(form) { this.form=form; } entries() { return Object.entries(this.form.values); } },
    document:{querySelector:element, addEventListener:(event,handler) => { events[event]=handler; }},
    fetch:async (...args) => { calls.push(args); return fetch(...args); },
    prompt:() => null, confirm:() => false,
  });
  vm.runInContext(script, context);
  vm.runInContext('greenhouse=async()=>{}; people=async()=>{};', context);
  return {context, element, events, calls};
}
function form() {
  const button={disabled:false};
  return {values:{tree:'einstruct',title:'A measured result'}, resets:0, querySelector:()=>button,
    reset(){this.resets++;}, button};
}

test('cancelling any ruling makes no request', async () => {
  const p=page();
  for(const verdict of ['approved','greenlit','changes','rejected']) await p.context.rule(7,verdict);
  assert.equal(p.calls.length,0);
});

test('a rejected save retains the form and shows the service error', async () => {
  const p=page(async()=>({ok:false,status:502,text:async()=>' {"detail":"database unavailable"}'}));
  const f=form();
  await p.context.submit({preventDefault(){},target:f},'/api/review');
  assert.equal(f.resets,0);
  assert.equal(f.button.disabled,false);
  assert.match(p.element('#action-status').textContent,/Not saved: database unavailable/);
  assert.equal(p.calls[0][1].headers['x-orchard'],'1');
});

test('network failure retains a directive and a retry can succeed', async () => {
  let fail=true;
  const p=page(async()=>{ if(fail) throw new Error('offline'); return {ok:true}; });
  const f=form();
  await p.context.submit({preventDefault(){},target:f},'/api/directive');
  assert.equal(f.resets,0);
  fail=false;
  await p.context.submit({preventDefault(){},target:f},'/api/directive');
  assert.equal(f.resets,1);
  assert.equal(p.element('#action-status').textContent,'Saved.');
});

test('double submission is ignored while a save is pending', async () => {
  let finish;
  const p=page(()=>new Promise(resolve=>{finish=resolve;}));
  const f=form(), ev={preventDefault(){},target:f};
  const first=p.context.submit(ev,'/api/review');
  await p.context.submit(ev,'/api/review');
  assert.equal(p.calls.length,1);
  finish({ok:true}); await first;
  assert.equal(f.resets,1);
});

test('editing the next draft during a successful save does not erase it', async () => {
  let finish;
  const p=page(()=>new Promise(resolve=>{finish=resolve;}));
  const f=form();
  const save=p.context.submit({preventDefault(){},target:f},'/api/review');
  f.values.title='A second measured result';
  finish({ok:true}); await save;
  assert.equal(f.resets,0);
  assert.equal(f.values.title,'A second measured result');
  assert.equal(JSON.parse(p.calls[0][1].body).title,'A measured result');
  assert.match(p.element('#action-status').textContent,/Your newer edits are still in the form/);
});

test('a stale action cannot post twice while successful save panels are still refreshing', async () => {
  const p=page(async()=>({ok:true}));
  let finishRefresh;
  p.context.holdRefresh=()=>new Promise(resolve=>{finishRefresh=resolve;});
  vm.runInContext('greenhouse=holdRefresh',p.context);
  const first=p.context.post('/api/people/kick',{who:'first-visitor'});
  while(!finishRefresh) await Promise.resolve();
  assert.equal(await p.context.post('/api/people/kick',{who:'first-visitor'}),false);
  assert.equal(p.calls.length,1);
  finishRefresh(); await first;
});

test('different visitors do not silently block one another while being moderated', async () => {
  const finishes=[];
  const p=page(()=>new Promise(resolve=>finishes.push(resolve)));
  const first=p.context.post('/api/people/mute',{who:'first-visitor',muted:true});
  const second=p.context.post('/api/people/mute',{who:'second-visitor',muted:true});
  assert.equal(p.calls.length,2);
  for(const finish of finishes) finish({ok:true});
  await Promise.all([first,second]);
});

test('a failed ruling keeps its note ready for a retry and cancellation still does nothing', async () => {
  const p=page(async()=>({ok:false,status:502,text:async()=>'database unavailable'}));
  p.context.prompt=()=> 'Show the comparison in the final frame';
  await p.context.rule(7,'changes');
  p.context.prompt=(_message,previous)=>{
    assert.equal(previous,'Show the comparison in the final frame');
    return null;
  };
  await p.context.rule(7,'changes');
  assert.equal(p.calls.length,1);
});

test('successful save stays successful when refreshing a panel fails', async () => {
  const p=page(async()=>({ok:true}));
  vm.runInContext('greenhouse=async()=>{throw new Error("offline")}',p.context);
  const f=form();
  await p.context.submit({preventDefault(){},target:f},'/api/review');
  assert.equal(f.resets,1);
  assert.match(p.element('#action-status').textContent,/Saved\. Some panels/);
  for(const id of ['reviews','rulings','directives','exhibits']) {
    assert.match(p.element('#'+id).innerHTML,/Greenhouse unavailable/);
  }
});

test('a failed refresh removes stale moderation and gate controls', async () => {
  const p=page();
  vm.runInContext('main=async()=>{}; audit=async()=>{}; people=async()=>{throw new Error("offline")}',p.context);
  for(const id of ['online','reports','bans','gate']) p.element('#'+id).innerHTML='<button>old action</button>';
  await p.context.refresh();
  for(const id of ['online','reports','bans']) assert.match(p.element('#'+id).innerHTML,/The grove unavailable/);
  assert.match(p.element('#gate').textContent,/Token gate unavailable/);
  assert.equal(p.element('#refresh').disabled,false);
});

test('invalid ban durations never become a permanent ban', async () => {
  for(const value of ['', ' ', 'no', '-2', '1.2', '10000001', 'Infinity']) {
    const p=page(); p.context.prompt=()=>value;
    await p.events.click({target:{closest:()=>({dataset:{act:'ban',who:'visitor'}})}});
    assert.equal(p.calls.length,0,value);
    assert.match(p.element('#action-status').textContent,/Enter whole minutes/);
  }
});

test('only web URLs become links and labels stay text', () => {
  const p=page();
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','not a url']) {
    assert.equal(p.context.link(url,'<b>Title</b>'),'&lt;b&gt;Title&lt;/b&gt;');
  }
  assert.match(p.context.link('https://example.com','Title'),/rel="noopener noreferrer"/);
});

test('a first-run ledger explains empty panels', async () => {
  const p=page(async url=>({ok:true,json:async()=>url==='/api/portfolio'?[]:{
    spend_recent:[], n_jobs:0, expdash_reachable:false, video_share:{video_h:0,total_h:0},
    cards:[], queue_wait:{}, running:[],
  }}));
  await p.context.main();
  assert.match(p.element('#trees').innerHTML,/No trees yet/);
  assert.match(p.element('#spend').innerHTML,/No lane usage recorded/);
  assert.match(p.element('#wait').innerHTML,/No queue waits/);
  assert.match(p.element('#running').innerHTML,/Connect expdash/);
});

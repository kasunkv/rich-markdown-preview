const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const filename = path.resolve(__dirname, '../src', name + '.ts');
  const mod = new Module(filename, module); cache.set(name, mod);
  mod.filename = filename; mod.paths = module.paths;
  mod.require = target => target.startsWith('./') ? load(target.slice(2)) : require(target);
  const contents = process.env.SOURCE_COVERAGE_ROOT ? require('../scripts/coverage-instrument.cjs').instrument(filename).code : fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const { validateWebviewMessage: valid, validateHostMessage: inbound, validateRestoredState: restored, validLink, validPreference, normalizeCSV, messageLimits, plainRecord } = load('messages');
const correlation = { requestId: 'request_1', renderId: 'render_1' };
const message = value => ({ ...correlation, ...value });
const prefs = { style: 'reading', appearance: 'auto', contentWidth: 900, fontSize: 16, lineHeight: 1.7, wrapCode: false };
test('all command discriminants validate with bounded identities', () => {
  assert.ok(valid({type:'ready'}));
  for (const value of [ {type:'preference',key:'style',value:'book'}, {type:'reference',id:'rmp-ref-1'}, {type:'link',href:'docs/guide.md#heading'}, {type:'copy',text:'Hello\nWorld\t'}, {type:'tableCopy',text:'"Name"\r\n',filename:'table-1.csv'}, {type:'tableExport',text:'"Name"\r\n',filename:'table-2.csv'}, ...['home','refresh','source','back','forward'].map(action => ({type:'documentationAction',action})), {type:'documentationAction',action:'open',id:'file:///docs/guide.md'} ]) assert.ok(valid(message(value)), JSON.stringify(value));
  for (const [key,value] of Object.entries(prefs)) assert.ok(validPreference(key,value));
  for (const [key,value] of [['bad',1],['fontSize',NaN],['contentWidth',Infinity],['fontSize',11],['lineHeight',3],['wrapCode','true'],['style','bad'],['appearance','sepia'],[null,16]]) assert.equal(validPreference(key,value), false);
});
test('malformed/prototype/accessor/unknown/control/oversized commands reject', () => {
  for (const value of [null, [], 3, 'copy', {}, {type:'unknown'}, message({type:'unknown'}), {type:'ready',text:'extra'}, {type:'copy',text:'missing ids'}, message({type:'copy',text:3}), message({type:'copy',text:'\x00'}), message({type:'copy',text:'x'.repeat(messageLimits.text+1)}), message({type:'link',href:'x'.repeat(messageLimits.uri+1)}), message({type:'reference',id:''}), message({type:'reference',id:'x'.repeat(messageLimits.id+1)}), message({type:'documentationAction',action:'delete'}), message({type:'documentationAction',action:'open'}), message({type:'documentationAction',action:'home',id:'other'}), message({type:'tableCopy',text:'unsafe',filename:'table-1.csv'}), message({type:'tableExport',text:'"a"\r\n',filename:'../table.csv'}), message({type:'preference',key:'constructor',value:1}), {...message({type:'copy',text:'a'}),extra:1}, {...message({type:'copy',text:'a'}),requestId:''}, {...message({type:'copy',text:'a'}),requestId:'x'.repeat(81)}, {...message({type:'copy',text:'a'}),renderId:'\n'}, Object.assign(Object.create({type:'copy'}), correlation, {text:'a'}), JSON.parse('{"type":"ready","__proto__":{}}'), { get type() { throw Error('must not run'); } }]) assert.equal(valid(value),false);
  assert.ok(plainRecord(Object.create(null)));
  assert.equal(plainRecord(new Date()), false);
});
test('URI policy rejects decoded scheme and control-character bypasses', () => {
  for (const value of ['https://example.com/a#b', 'http://localhost/a', 'mailto:person@example.com', '../file.md#Title', 'docs.md#%ZZ', '/file.md']) assert.ok(validLink(value),value);
  for (const value of ['javascript:alert(1)','command:workbench.action.closeWindow','file:///tmp/a','https://','https:example.com','http:example.com','https://u:p@example.com','//example.com','%2f%2fexample.com','%63ommand:evil','a%00b','a%0Ab', 'docs.md#%0A', 'docs.md#%ZZ%00','a%7fb',' a.md','a\\b','a%5cb','a%zz','https://example.com\n']) assert.equal(validLink(value),false,value);
});
test('quoted CSV reserializes formula policy, embedded delimiters and signed numbers', () => {
  assert.equal(normalizeCSV('"=1","+cmd","-12","+1.5","@cmd","a,b","a""b","line\nline"\r\n'), '"\'=1","\'+cmd","-12","+1.5","\'@cmd","a,b","a""b","line\nline"\r\n');
  assert.equal(normalizeCSV('"\'=1"\r\n'), '"\'=1"\r\n');
  for (const value of ['', 'abc', '"a', '"a"', '"a",', '"a"\n', '"a"junk\r\n', '"a"\r\n,', '"a\x00"\r\n', '"'+'a'.repeat(messageLimits.text)+'"\r\n']) assert.equal(normalizeCSV(value),undefined);
  const large = ('"texttexttexttexttexttext","-3","=1"\r\n').repeat(60000);
  const safe = normalizeCSV(large); assert.ok(safe && safe.length > 2*1024*1024); assert.ok(valid(message({type:'tableCopy',text:safe,filename:'table-999.csv'})));
});
test('browser inbound messages validate actual nested structures', () => {
  const render = {type:'render',html:'<h1>Hello</h1>',outline:[{id:'h1',fragment:'hello',text:'Hello',level:1}],preferences:prefs,documentId:'file:///a.md',renderId:'render_1',documentationHome:false,fragment:'hello'};
  const docs = {type:'documentation',files:[{id:'file:///a.md',root:'file:///docs',rootName:'Docs',path:'a.md'}],roots:['file:///docs'],complete:true,truncated:false,loading:false,canBack:false,canForward:true};
  for (const value of [render,docs,{type:'preferences',preferences:prefs},{type:'copyResult',requestId:'request_1',success:true},{type:'tableActionResult',requestId:'request_2',action:'tableExport',cancelled:true},{type:'tableActionResult',requestId:'request_3',action:'tableCopy',success:false,error:'Try again'}]) assert.ok(inbound(value),JSON.stringify(value));
  for (const value of [null,[],{type:'other'},{...render,preferences:{...prefs,fontSize:Infinity}},{...render,outline:[{...render.outline[0],level:7}]},{...render,outline:[{...render.outline[0],fragment:3}]},{...render,html:'\x00'},{...render,documentId:''},{...render,renderId:''},{...render,fragment:'\n'},{...render,documentationHome:1},{...docs,files:[{...docs.files[0],path:1}]},{...docs,complete:'yes'},{...docs,roots:['']},{...docs,active:3},{...docs,error:3},{type:'copyResult',requestId:'',success:true},{type:'tableActionResult',requestId:'r',action:'delete',success:true},{type:'tableActionResult',requestId:'r',action:'tableExport',cancelled:true,success:true},{type:'tableActionResult',requestId:'r',action:'tableCopy',success:false,error:3}]) assert.equal(inbound(value),false);
});
test('restored state rejects poisoned maps and malformed nested reading state', () => {
  const reading = {scroll:10,tables:{key:{query:'term',column:1,direction:'ascending',density:'compact'}},disclosures:{section:true}};
  assert.ok(restored({ ...reading, documentId:'file:///a.md',documents:{'file:///a.md':reading},documentation:{expanded:['folder'],filter:'guide',outline:true}})); assert.ok(restored({}));
  for (const value of [null,[],{scroll:NaN},{scroll:-1},{documentId:2},{tables:[]},{tables:{key:{query:2,column:1,direction:'none',density:'compact'}}},{tables:{key:{query:'',column:-1,direction:'none',density:'compact'}}},{tables:{key:{query:'',column:0,direction:'bad',density:'compact'}}},{disclosures:{section:1}},{documents:{file:{scroll:'bad'}}},{documentation:{expanded:[1]}},{documentation:{filter:1}},{documentation:{outline:1}},JSON.parse('{"documents":{"__proto__":{}}}')]) assert.equal(restored(value),false);
});

test('limits cover expansion and browser collections without permissive fallback', () => {
  const formulaRow = Array(1000).fill('"=1"').join(',') + '\r\n';
  const expansion = formulaRow.repeat(Math.floor(messageLimits.text / formulaRow.length));
  assert.equal(normalizeCSV(expansion), undefined);
  assert.equal(valid(message({type:'tableCopy',text:expansion,filename:'table-1.csv'})), false);
  for (const input of [Object.assign(Object.create(null),{type:'ready'}), message({type:'copy',text:''}), message({type:'preference',key:'fontSize',value:17.5})]) assert.ok(valid(input));
  assert.ok(inbound({type:'render',html:'',outline:[],preferences:prefs}));
  assert.ok(inbound({type:'documentation',files:[],loading:true,canBack:false,canForward:false,error:'Unavailable',active:'file:///active.md'}));
  for (const input of [{type:'preferences',preferences:null},{type:'render',html:'',outline:Array(messageLimits.items+1).fill({}),preferences:prefs},{type:'documentation',files:Array(messageLimits.items+1).fill({}),loading:false,canBack:false,canForward:false},{type:'render',html:'',outline:[null],preferences:prefs},{type:'copyResult',requestId:'x'.repeat(messageLimits.request+1),success:true}]) assert.equal(inbound(input),false);
  for (const input of [{anything:[]},{documentation:{unknown:true}},{documents:{file:{unknown:1}}},{tables:{key:{query:'',column:0,direction:'none',density:'bad'}}},{tables:{key:{query:'',column:0,direction:'none',density:'compact',anything:1}}},{documentId:'__proto__'},{documentation:{expanded:Array(10001).fill('folder')}},{disclosures:Object.fromEntries(Array.from({length:10001},(_,i)=>[i,true]))}]) assert.equal(restored(input),false);
  assert.ok(restored({documentation:{},documents:{file:{tables:{key:{query:'',column:0,direction:'none',density:'comfortable'}}}}}));
});

test('CSV incremental row/column/cell budgets reject delimiter-heavy inputs', () => {
  for (const input of ['""\r\n'.repeat(messageLimits.csvRows+1), Array(messageLimits.csvColumns+1).fill('""').join(',')+'\r\n', (Array(1000).fill('""').join(',')+'\r\n').repeat(1001)]) { assert.ok(input.length <= messageLimits.text); assert.equal(normalizeCSV(input),undefined); assert.equal(valid(message({type:'tableExport',text:input,filename:'table-1.csv'})),false); }
});

test('image permission command origins are exact concrete bounded HTTPS origins', () => {
  for (const type of ['grantExternalImageOrigin','revokeExternalImageOrigin']) {
    assert.equal(valid(message({type,origin:'https://example.com'})),true);
    for (const origin of [undefined,3,'https://example.com/','HTTPS://example.com','http://example.com','https://*','https://*.example.com','https://@example.com','https://example.com;','https://example.com\n'])
      assert.equal(valid(message({type,origin})),false);
    assert.equal(valid({...message({type,origin:'https://example.com'}),extra:true}),false);
  }
});

test('permission reset focus state is bounded and validates caret selection before restore', () => {
  for (const focus of [{key:'reading-key'},{key:'reading-key',documentId:'file:///a',selection:[0,3,'backward']},{key:'reading-key',selection:[0,0,'none']},{key:'reading-key',selection:[1,3,'forward']}])
    assert.equal(restored({permissionFocus:focus}),true);
  for (const focus of [null,[],{key:''},{key:'x'.repeat(8193)},{key:'a',documentId:''},{key:'a',extra:1},{key:'a',selection:0},{key:'a',selection:[]},{key:'a',selection:[0.5,3,'forward']},{key:'a',selection:[0,3.5,'forward']},{key:'a',selection:[-1,3,'forward']},{key:'a',selection:[3,1,'forward']},{key:'a',selection:[0,3,'invalid']}])
    assert.equal(restored({permissionFocus:focus}),false);
});
test('render session context matches its panel kind and rejects privileged/hostile metadata',()=>{
 const session={version:1,kind:'preview',target:'file:///a.md',history:['file:///a.md'],cursor:0};
 const render={type:'render',html:'',outline:[],preferences:prefs,documentId:'file:///a.md',session};
 assert.ok(inbound(render));assert.ok(inbound({...render,documentationHome:true,session:{...session,kind:'documentation'}}));
 for(const item of [{...render,documentationHome:true},{...render,session:{...session,version:2}},{...render,session:{...session,privacyGrants:['https://example.com']}},{...render,session:{...session,history:Array(21).fill(session.target)}}])assert.equal(inbound(item),false);
});

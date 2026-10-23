import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parse} from '@babel/parser';
import traverseModule, {type NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import {Failure,privatePath,sourceInput} from './input.js';
import type {Context,Catalog,EffectiveProfile,Contribution,CodeAnalysis,CodeNode} from './types.js';
const traverse = traverseModule.default;
type P = NodePath<any>;
type Unit = {file:string; ast:t.File; program:P; nodes:Map<string,P[]>; imports:Map<string,{source:string; imported:string}>; whole:boolean};
const publicModules = new Set(['src/util.js','src/api.js','src/help.js']);
const publicPackages = new Set(['uhtml','dompurify']);
function diagnostic(code:string,message:string,file:string,node?:t.Node):never {
  throw new Failure(3,{code,phase:'adapter',message,file,causes:[],...(node?.loc?{range:{start:{line:node.loc.start.line,column:node.loc.start.column},end:{line:node.loc.end.line,column:node.loc.end.column}}}:{})});
}
function chain(node:t.Node):{root:string; members:string[]; dynamic:boolean}|undefined {
  if(t.isIdentifier(node)) {return {root:node.name,members:[],dynamic:false};}
  if(t.isMemberExpression(node)||t.isOptionalMemberExpression(node)) {const base=chain(node.object);if(!base) {return undefined;} const property=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;return {...base,members:[...base.members,property??'?'],dynamic:base.dynamic||property===undefined};}
  return undefined;
}
function checkForbiddenCall(node:t.CallExpression|t.OptionalCallExpression,file:string):void {
  if(t.isImport(node.callee)||t.isIdentifier(node.callee)&&['eval','require'].includes(node.callee.name)) {diagnostic('AST_DYNAMIC_CODE','Dynamic code loading is unsupported',file,node);}
}
function declaration(node:t.Node):t.Node|null {return t.isExportNamedDeclaration(node)?node.declaration??null:node;}
function checkInitializer(node:t.Node|undefined|null,file:string):void {
  if(!node) {return;}
  if(t.isFunction(node)) {if((t.isObjectMethod(node)||t.isClassMethod(node))&&node.computed) {checkInitializer(node.key,file);}return;}
  if(t.isOptionalCallExpression(node)) {diagnostic('AST_TOP_LEVEL_EFFECT','Optional eager calls are unsupported in top-level initializers',file,node);}
  if(t.isCallExpression(node)) {
    const c=chain(node.callee);const name=c?[c.root,...c.members].join('.'):'';
    const known:Record<string,string[]>={'src/actions.js':['actions.dispatchEvents.bind'],'src/search-engines.js':['googleCustomSearch','getDuckduckgoFaviconUrl','cratesCb'],'src/keys.js':['actions.gh.star'],'src/util.js':['promisify','localStorageFns'],'src/api.js':['getApi']};
    const literalJoin=t.isMemberExpression(node.callee)&&!node.callee.computed&&t.isIdentifier(node.callee.property,{name:'join'})&&t.isArrayExpression(node.callee.object)&&node.callee.object.elements.every(e=>t.isStringLiteral(e))&&node.arguments.length===1&&t.isStringLiteral(node.arguments[0]);
    if(!literalJoin&&!known[file]?.includes(name)) {diagnostic('AST_TOP_LEVEL_EFFECT','Unknown eager call in top-level initializer',file,node);}
  }
  if(t.isNewExpression(node)||t.isAwaitExpression(node)||t.isAssignmentExpression(node)||t.isUpdateExpression(node)||t.isTaggedTemplateExpression(node)||t.isImportExpression(node)||t.isUnaryExpression(node,{operator:'delete'})) {diagnostic('AST_TOP_LEVEL_EFFECT','Unknown eager effect in top-level initializer',file,node);}
  const c=chain(node);if(c&&['window','document','browser','chrome'].includes(c.root)) {diagnostic('AST_TOP_LEVEL_EFFECT','Top-level browser access is unsupported here',file,node);}
  for(const key of t.VISITOR_KEYS[node.type]??[]) {const child=(node as any)[key];if(Array.isArray(child)) {for(const item of child) {checkInitializer(item,file);}}else if(child&&typeof child==='object') {checkInitializer(child,file);}}
}
function unit(text:string,file:string,whole=false):Unit {
  let ast:t.File;try {ast=parse(text,{sourceType:'module',createImportExpressions:true});} catch(error) {const e=error as {message:string;loc?:{line:number;column:number}};diagnostic('AST_PARSE',e.message,file,e.loc?{loc:{start:e.loc,end:e.loc}} as t.Node:undefined);}
  let program!:P;traverse(ast,{Program(p){program=p;}});const nodes=new Map<string,P[]>();const imports=new Map<string,{source:string;imported:string}>();
  function add(id:string,p:P):void {nodes.set(id,[...(nodes.get(id)??[]),p]);}
  for(const p of program.get('body') as P[]) {
    const q=p.isExportNamedDeclaration()&&p.node.declaration?p.get('declaration') as P:p;const n=q.node;
    if(t.isImportDeclaration(n)) {for(const spec of n.specifiers) {imports.set(spec.local.name,{source:n.source.value,imported:t.isImportDefaultSpecifier(spec)?'default':t.isImportNamespaceSpecifier(spec)?'*':t.isIdentifier(spec.imported)?spec.imported.name:spec.imported.value});}}
    else if(t.isVariableDeclaration(n)) {for(const d of q.get('declarations') as P[]) {for(const name of Object.keys(t.getBindingIdentifiers(d.node.id))) {add(name,d);}}}
    else if(t.isFunctionDeclaration(n)&&n.id) {add(n.id.name,q);}
    else if(t.isExpressionStatement(n)&&t.isAssignmentExpression(n.expression)&&n.expression.operator==='=') {const c=chain(n.expression.left);if(c&&!c.dynamic) {add([c.root,...c.members].join('.'),p.get('expression.right') as P);}}
  }
  const amazon=nodes.get('maps.amazon.com')?.[0];
  if(amazon?.isArrayExpression()) {for(const [i,item] of (amazon.get('elements') as P[]).entries()) {if(item?.isObjectExpression()) {for(const prop of item.get('properties') as P[]) {if(prop.isObjectProperty()&&t.isIdentifier(prop.node.key,{name:'callback'})) {add(`amazonCallback.${i}`,prop.get('value') as P);}}}}}
  return {file,ast,program,nodes,imports,whole};
}
/** Pure fixture API; production callers separately enforce the fixed Git SHA and source lock. */
export function analyzeFixtureModules(texts:Record<string,string>,roots:{file:string;symbol:string;reason:string}[]):CodeAnalysis {
  const units=new Map(Object.entries(texts).map(([file,text])=>[file,unit(text,file,publicModules.has(file))]));
  const output:CodeNode[]=[];const edges:{from:string;to:string}[]=[];const external=new Set<string>();const debt:{file:string;reason:string}[]=[];const done=new Set<string>();
  function visit(file:string,symbol:string,reason:string,from?:string):void {
    const u=units.get(file);if(!u) {diagnostic('IMPORT_MISSING',`Missing analyzed module ${file}`,file);}
    const id=`${file}#${u.whole?'*':symbol}`;if(from&&!edges.some(e=>e.from===from&&e.to===id)) {edges.push({from,to:id});}
    const existing=output.find(n=>n.id===id);if(existing) {if(!existing.reasons.includes(reason)) {existing.reasons.push(reason);} return;}
    for(const statement of u.program.get('body') as P[]) {const n=declaration(statement.node);if(!n) {continue;}if(t.isVariableDeclaration(n)) {for(const d of n.declarations) {checkInitializer(d.id,file);checkInitializer(d.init,file);}}else if(t.isExpressionStatement(n)&&t.isAssignmentExpression(n.expression)) {checkInitializer(n.expression.right,file);}else if(t.isExportDefaultDeclaration(n)) {if(!t.isIdentifier(n.declaration)||u.whole) {checkInitializer(n.declaration,file);}}}
    for(const statement of u.program.get('body') as P[]) {if(statement.isImportDeclaration()) {const n=statement.node;
      if(u.whole||!n.specifiers.length) {if(privatePath(n.source.value)) {diagnostic('PRIVATE_INPUT_UNSUPPORTED','Retained import targets private input',file,n);}if(!n.source.value.startsWith('.')) {if(!u.whole||!publicPackages.has(n.source.value)) {diagnostic('EXTERNAL_IMPORT_UNSUPPORTED','Retained import targets unsupported external package',file,n);}external.add(n.source.value);}else if(!n.specifiers.length) {const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),n.source.value));if(!publicModules.has(target)) {diagnostic('AST_SIDE_EFFECT_IMPORT','Unsupported side-effect import',file,n);}void target;}}
    }}
    if(u.whole) {for(const statement of u.program.get('body') as P[]) {const n=declaration(statement.node);if(!n) {continue;}
      if(t.isImportDeclaration(n)||t.isFunctionDeclaration(n)||t.isEmptyStatement(n)) {continue;}
      if(t.isVariableDeclaration(n)) {for(const d of n.declarations) {if(t.isCallExpression(d.init)&&!(file==='src/util.js'&&t.isIdentifier(d.init.callee)&&['promisify','localStorageFns'].includes(d.init.callee.name))) {diagnostic('AST_TOP_LEVEL_EFFECT','Unknown public-module initializer',file,d);}}continue;}
      if(t.isExpressionStatement(n)&&t.isAssignmentExpression(n.expression)&&n.expression.operator==='=') {const lhs=chain(n.expression.left);if(file==='src/util.js'&&lhs?.root==='util'&&!lhs.dynamic) {continue;}}
      if(t.isExportDefaultDeclaration(n)&&(t.isIdentifier(n.declaration)||t.isObjectExpression(n.declaration)||file==='src/api.js'&&t.isCallExpression(n.declaration)&&t.isIdentifier(n.declaration.callee,{name:'getApi'})&&n.declaration.arguments.length===0)) {continue;}
      diagnostic('AST_TOP_LEVEL_EFFECT','Unknown public-module top-level effect',file,n);
    }}
    if(!u.whole) {for(const statement of u.program.get('body') as P[]) {
      const n=declaration(statement.node);if(!n) {continue;}
      if(t.isVariableDeclaration(n)) {for(const declaration of n.declarations) {if((t.isCallExpression(declaration.init)&&!(t.isMemberExpression(declaration.init.callee)&&t.isArrayExpression(declaration.init.callee.object)&&declaration.init.callee.object.elements.every(e=>t.isStringLiteral(e))&&t.isIdentifier(declaration.init.callee.property,{name:'join'})&&!declaration.init.callee.computed&&declaration.init.arguments.length===1&&t.isStringLiteral(declaration.init.arguments[0])))||t.isNewExpression(declaration.init)||t.isAwaitExpression(declaration.init)) {diagnostic('AST_TOP_LEVEL_EFFECT','Unsupported top-level variable initialization',file,declaration);}}continue;}
      if(t.isImportDeclaration(n)||t.isFunctionDeclaration(n)||t.isExportDefaultDeclaration(n)||t.isExportNamedDeclaration(n)||t.isEmptyStatement(n)) {continue;}
      if(t.isExpressionStatement(n)&&t.isAssignmentExpression(n.expression)&&n.expression.operator==='=') {const lhs=chain(n.expression.left);if(lhs&&['actions','completions','maps'].includes(lhs.root)&&!lhs.dynamic) {continue;}}
      if(file==='src/keys.js'&&t.isIfStatement(n)&&t.isMemberExpression(n.test)&&t.isIdentifier(n.test.object,{name:'priv'})&&t.isIdentifier(n.test.property,{name:'doi_handler'})) {continue;}
      diagnostic('AST_TOP_LEVEL_EFFECT','Unknown top-level effect or registry write',file,n);
    }}
    let paths:P[];
    if(u.whole) {paths=[u.program];debt.push({file,reason:'Public module retained conservatively; browser initialization is deferred to generated runtime'});}
    else {paths=u.nodes.get(symbol)??[];if(paths.length!==1) {diagnostic(paths.length?'AST_DUPLICATE_SYMBOL':'AST_UNKNOWN_SYMBOL',`Expected one declaration for ${symbol}`,file,paths[0]?.node??u.ast.program);} }
    if(!u.whole&&(paths[0].isCallExpression()||paths[0].isVariableDeclarator()&&t.isCallExpression(paths[0].node.init))) {diagnostic('AST_INITIALIZATION_EFFECT','Unsupported reachable top-level call initializer',file,paths[0].node);}
    const loc=paths[0].node.loc!;output.push({id,file,symbol:u.whole?'*':symbol,reasons:[reason],range:{start:{line:loc.start.line,column:loc.start.column},end:{line:loc.end.line,column:loc.end.column}}});done.add(id);
    if(!u.whole&&/^(actions|completions|maps)\./.test(symbol)) {const pieces=symbol.split('.');for(let i=1;i<pieces.length;i++) {visit(file,pieces.slice(0,i).join('.'),`container of ${id}`,id);}}
    for(const statement of u.program.get('body') as P[]) {if(statement.isImportDeclaration()&&(u.whole||!statement.node.specifiers.length)&&statement.node.source.value.startsWith('.')) {const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),statement.node.source.value));if(!publicModules.has(target)) {diagnostic('AST_SIDE_EFFECT_IMPORT','Unsupported whole-module dependency',file,statement.node);}visit(target,'*',`retained import of ${id}`,id);}}
    const reference=(p:P):void=>{
      const c=chain(p.node);if(!c) {return;}const binding=p.scope.getBinding(c.root);if(!binding) {if(!u.whole&&!new Set(['window','document','navigator','URL','JSON','Object','Array','String','Number','Boolean','RegExp','Promise','Set','Map','Date','Math','Error','TypeError','console','setTimeout','clearTimeout','setInterval','clearInterval','undefined','NaN','Infinity','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','parseInt','parseFloat','isNaN','isFinite','fetch','alert','confirm','prompt']).has(c.root)) {diagnostic('AST_UNKNOWN_GLOBAL',`Unknown unbound reference ${c.root}`,file,p.node);}return;}if(binding.scope!==u.program.scope) {return;}
      const imp=u.imports.get(c.root);
      if(c.dynamic) {diagnostic('AST_DYNAMIC_MEMBER',`Dynamic access to module binding ${c.root}`,file,p.node);}
      if(imp) {
        if(privatePath(imp.source)) {diagnostic('PRIVATE_INPUT_UNSUPPORTED','Reachable private import is unsupported',file,p.node);}
        if(!imp.source.startsWith('.')) {if(!publicPackages.has(imp.source)||!u.whole) {diagnostic('EXTERNAL_IMPORT_UNSUPPORTED',`Unsupported external package ${imp.source}`,file,p.node);} external.add(imp.source);return;}
        const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),imp.source));const targetUnit=units.get(target);if(!targetUnit) {diagnostic('IMPORT_MISSING',`Unsupported imported module ${target}`,file,p.node);}
        const container=target==='src/actions.js'?'actions':target==='src/search-engines.js'?'completions':undefined;
        if(!targetUnit.whole&&(!container||imp.imported!=='default'||!c.members.length)) {diagnostic('AST_OBJECT_ESCAPE','Whole registry object or unsupported import escapes',file,p.node);}
        visit(target,targetUnit.whole?'*':[container,...c.members].join('.'),`dependency of ${id}`,id);return;
      }
      if(u.whole) {return;}
      const rootNode=u.nodes.get(c.root)?.[0];
      const isRegistry=['actions','completions','maps'].includes(c.root);
      if(isRegistry&&!c.members.length) {diagnostic('AST_OBJECT_ESCAPE',`Whole registry ${c.root} escapes`,file,p.node);}
      const target=isRegistry?[c.root,...c.members].join('.'):c.root;
      if(target!==symbol) {visit(file,target,`dependency of ${id}`,id);}
      if(isRegistry&&c.members.length>0) {visit(file,[c.root,...c.members.slice(0,-1)].join('.'),`container of ${id}`,id);}
      if(!rootNode&& !u.nodes.has(target)) {diagnostic('AST_UNKNOWN_SYMBOL',`Unknown binding ${target}`,file,p.node);}
    };
    const mutation=(target:P,owner:P):void=>{
      if(target.isIdentifier()||target.isMemberExpression()||target.isOptionalMemberExpression()) {
        const c=chain(target.node);const binding=c?target.scope.getBinding(c.root):undefined;
        if(c&&binding?.scope===u.program.scope) {
          if(!u.whole&&(['actions','completions','maps'].includes(c.root)||u.imports.has(c.root))) {diagnostic('AST_REGISTRY_WRITE','Reachable code mutates a registry or import binding',file,owner.node);}
          reference(target);
        } else if(!binding) {reference(target);}
        return;
      }
      if(target.isObjectPattern()) {for(const property of target.get('properties') as P[]) {mutation(property.isRestElement()?property.get('argument') as P:property.get('value') as P,owner);}return;}
      if(target.isArrayPattern()) {for(const element of target.get('elements') as P[]) {if(element.node) {mutation(element,owner);}}return;}
      if(target.isAssignmentPattern()) {mutation(target.get('left') as P,owner);return;}
      if(target.isRestElement()) {mutation(target.get('argument') as P,owner);return;}
      diagnostic('AST_WRITE_UNSUPPORTED','Unsupported write target',file,owner.node);
    }
    for(const p of paths) {
      const visitor={AssignmentExpression(q:P){mutation(q.get('left') as P,q);},UpdateExpression(q:P){mutation(q.get('argument') as P,q);},ForInStatement(q:P){const left=q.get('left') as P;if(!left.isVariableDeclaration()) {mutation(left,q);}},ForOfStatement(q:P){const left=q.get('left') as P;if(!left.isVariableDeclaration()) {mutation(left,q);}},UnaryExpression(q:P){if(q.node.operator==='delete') {mutation(q.get('argument') as P,q);}},ReferencedIdentifier(q:P){if(q.parentPath?.isMemberExpression()&&q.key==='object'||q.parentPath?.isOptionalMemberExpression()&&q.key==='object') {return;}reference(q);},MemberExpression(q:P){if((q.parentPath?.isMemberExpression()||q.parentPath?.isOptionalMemberExpression())&&q.key==='object') {return;}if(q.isReferenced()) {reference(q);}},OptionalMemberExpression(q:P){if(q.isReferenced()) {reference(q);}},ImportExpression(q:P){diagnostic('AST_DYNAMIC_IMPORT','Dynamic import is unsupported',file,q.node);},CallExpression(q:P){checkForbiddenCall(q.node,file);},OptionalCallExpression(q:P){checkForbiddenCall(q.node,file);}};
      p.traverse(visitor);if(p.isIdentifier()||p.isMemberExpression()) {reference(p);}
    }
  }
  for(const root of roots) {visit(root.file,root.symbol,root.reason);}
  // Tarjan components preserve recursive code without turning dependency edges into registrations.
  let next=0;const indexes=new Map<string,number>(),low=new Map<string,number>();const stack:string[]=[];const active=new Set<string>();const components:string[][]=[];
  function component(id:string):void {indexes.set(id,next);low.set(id,next++);stack.push(id);active.add(id);for(const edge of edges.filter(e=>e.from===id)) {if(!indexes.has(edge.to)) {component(edge.to);low.set(id,Math.min(low.get(id)!,low.get(edge.to)!));} else if(active.has(edge.to)) {low.set(id,Math.min(low.get(id)!,indexes.get(edge.to)!));}}if(low.get(id)===indexes.get(id)) {const group:string[]=[];let member:string;do {member=stack.pop()!;active.delete(member);group.push(member);} while(member!==id);components.push(group.sort());}}
  for(const id of done) {if(!indexes.has(id)) {component(id);}}
  return {status:'complete',nodes:output.sort((a,b)=>a.id.localeCompare(b.id)),edges:edges.sort((a,b)=>`${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)),components:components.sort((a,b)=>a[0].localeCompare(b[0])),externalDependencies:[...external].sort(),optimizationDebt:debt.sort((a,b)=>a.file.localeCompare(b.file))};
}
function property(object:t.ObjectExpression,name:string,file:string):t.Expression {
  const properties=object.properties.filter(p=>t.isObjectProperty(p)&&!p.computed&&(t.isIdentifier(p.key)?p.key.name:t.isStringLiteral(p.key)?p.key.value:undefined)===name) as t.ObjectProperty[];
  if(properties.length!==1||!t.isExpression(properties[0].value)) {diagnostic('ADAPTER_SHAPE',`Expected literal property ${name}`,file,object);}return properties[0].value as t.Expression;
}
function stringProperty(object:t.ObjectExpression,name:string,file:string):string {const value=property(object,name,file);if(!t.isStringLiteral(value)) {diagnostic('ADAPTER_SHAPE',`Expected string ${name}`,file,value);}return value.value;}
async function extensionAnalysis(root:string,entry:string,label:string,read:(file:string)=>Promise<string>):Promise<CodeAnalysis> {
  const nodes:CodeNode[]=[];const edges:{from:string;to:string}[]=[];const visited=new Set<string>();
  async function visit(relative:string,isEntry:boolean):Promise<void> {
    const file=await sourceInput(root,relative);const canonical=path.relative(root,file).split(path.sep).join('/');const display=`${label}/${canonical}`;
    if(visited.has(canonical)) {return;}visited.add(canonical);const u=unit(await read(file),display);const id=`${display}#module`;const loc=u.ast.program.loc!;nodes.push({id,file:display,symbol:'module',reasons:[isEntry?'selected extension entry':'transitive static ESM import'],range:{start:{line:loc.start.line,column:loc.start.column},end:{line:loc.end.line,column:loc.end.column}}});
    let hasFactory=false;
    function pure(n:t.Node|undefined|null):boolean {if(!n) {return true;}if(t.isLiteral(n)||t.isFunction(n)) {return true;}if(t.isIdentifier(n)) {return !!u.program.scope.getBinding(n.name)||n.name==='undefined';}if(t.isObjectExpression(n)) {return n.properties.every(p=>t.isObjectMethod(p)&&!p.computed||t.isObjectProperty(p)&&!p.computed&&pure(p.value));}if(t.isArrayExpression(n)) {return n.elements.every(e=>pure(e));}return false;}
    for(const p of u.program.get('body') as P[]) {
      const n=p.node;
      if(t.isImportDeclaration(n)||t.isExportNamedDeclaration(n)&&n.source) {const source=n.source!.value;if(!source.startsWith('.')) {diagnostic('EXTERNAL_IMPORT_UNSUPPORTED','Extensions support relative static ESM imports only',display,n);}const target=path.posix.normalize(path.posix.join(path.posix.dirname(canonical),source));const resolved=await sourceInput(root,target);const targetDisplay=`${label}/${path.relative(root,resolved).split(path.sep).join('/')}`;edges.push({from:id,to:`${targetDisplay}#module`});await visit(target,false);continue;}
      const declaration=t.isExportNamedDeclaration(n)?n.declaration:n;
      if(t.isExportDefaultDeclaration(n)) {
        let factory:t.Node=n.declaration;if(t.isIdentifier(factory)) {const binding=u.program.scope.getBinding(factory.name);const bp=binding?.path;if(bp?.isFunctionDeclaration()) {factory=bp.node;} else if(bp?.isVariableDeclarator()&&bp.node.init) {factory=bp.node.init;}}
        if(!t.isFunction(factory)||factory.async||factory.generator) {diagnostic('EXTENSION_FACTORY','Default export must be a statically identifiable synchronous non-generator function',display,n);}hasFactory=true;
        // Return value shape must be directly identifiable; W3 checks complete runtime callback IDs.
        if(t.isBlockStatement(factory.body)) {const statements=factory.body.body;for(const [index,statement] of statements.entries()) {
          if(t.isReturnStatement(statement)&&index===statements.length-1) {continue;}
          if(t.isFunctionDeclaration(statement)||t.isEmptyStatement(statement)) {continue;}
          if(t.isVariableDeclaration(statement)&&statement.declarations.every(d=>t.isIdentifier(d.id))) {for(const d of statement.declarations) {checkInitializer(d.init,display);}continue;}
          diagnostic('EXTENSION_FACTORY','Factory body supports declarations followed by one final direct return',display,statement);
        }}
        const returns:t.Node[]=t.isBlockStatement(factory.body)?factory.body.body.filter(t.isReturnStatement).flatMap(r=>r.argument?[r.argument]:[]):[factory.body];
        if(returns.length!==1||!t.isObjectExpression(returns[0])||!t.isObjectExpression(property(returns[0],'callbacks',display))) {diagnostic('EXTENSION_FACTORY','Factory must directly return an object with callbacks object',display,factory);}
        checkInitializer(returns[0],display);
        continue;
      }
      if(t.isFunctionDeclaration(declaration)||t.isEmptyStatement(declaration)) {continue;}
      if(t.isVariableDeclaration(declaration)&&declaration.declarations.every(d=>t.isIdentifier(d.id)&&pure(d.init))) {continue;}
      if(t.isExportNamedDeclaration(n)&&!n.declaration&&!n.source) {continue;}
      diagnostic('EXTENSION_TOP_LEVEL_EFFECT','Unsupported extension top-level statement or initialization',display,n);
    }
    if(isEntry&&!hasFactory) {diagnostic('EXTENSION_FACTORY','Selected entry requires a default factory',display,u.ast.program);}
    traverse(u.ast,{ImportExpression(p){diagnostic('AST_DYNAMIC_IMPORT','Dynamic import is unsupported',display,p.node);},CallExpression(p){checkForbiddenCall(p.node,display);checkRegistrationCall(p,display);},OptionalCallExpression(p){checkForbiddenCall(p.node,display);checkRegistrationCall(p,display);}});
  }
  await visit(entry,true);return {status:'complete',nodes:nodes.sort((a,b)=>a.id.localeCompare(b.id)),edges,components:strongComponents(nodes.map(n=>n.id),edges),externalDependencies:[],optimizationDebt:[{file:`${label}/${entry}`,reason:'Selected extension entry retained conservatively, including suppressed callback bodies; runtime callback selection remains W3'}]};
}
export async function analyzeCode(ctx:Context,catalog:Catalog,profile:EffectiveProfile,result:{contributions:(Contribution&{featureId:string})[];resolvedCapabilities:string[];resolvedFeatures:string[]},capture?:Map<string,string>):Promise<CodeAnalysis> {
  const read=async(file:string):Promise<string>=>{const text=await readFile(file,'utf8');capture?.set(file,text);return text;};
  const texts:Record<string,string>={};const roots:{file:string;symbol:string;reason:string}[]=[];
  // Only known public fixed-SHA source modules are inspected; private imports are never read.
  const amazon=result.contributions.filter(c=>c.featureId==='upstream/actions.amazon');const ddg=result.contributions.filter(c=>c.featureId==='upstream/search-engines.ddg');
  {for(const file of ['src/keys.js','src/actions.js','src/search-engines.js','src/util.js','src/api.js','src/help.js']) {texts[file]=await read(await sourceInput(ctx.upstream,file));}}
  roots.push({file:'src/api.js',symbol:'*',reason:'registration runtime'});
  if(amazon.length) {
    const u=unit(texts['src/keys.js'],'src/keys.js');const matches=u.nodes.get('maps.amazon.com');if(matches?.length!==1||!matches[0].isArrayExpression()) {diagnostic('ADAPTER_SHAPE','Amazon map must be one array assignment','src/keys.js',u.ast.program);}const map=matches[0].node as t.ArrayExpression;
    const feature=catalog.entries.find(e=>e.id==='upstream/actions.amazon')!;if(map.elements.length!==8) {diagnostic('ADAPTER_SHAPE','Amazon requires exactly eight mappings','src/keys.js',map);}
    for(let i=0;i<8;i++) {const item=map.elements[i];if(!t.isObjectExpression(item)||stringProperty(item,'alias','src/keys.js')!==feature.contributions[i].alias||stringProperty(item,'description','src/keys.js')!==feature.contributions[i].description) {diagnostic('ADAPTER_SHAPE','Amazon metadata differs from fixed adapter','src/keys.js',item??map);}const callback=property(item,'callback','src/keys.js');if(!t.isFunction(callback)&&!t.isMemberExpression(callback)) {diagnostic('ADAPTER_SHAPE','Unsupported Amazon callback','src/keys.js',callback);}}
    // Index contribution callbacks separately, so overridden mappings cease to be roots.
    for(const contribution of amazon) {const idx=feature.contributions.findIndex(c=>c.id===contribution.id.split('#').pop());roots.push({file:'src/keys.js',symbol:`amazonCallback.${idx}`,reason:contribution.id});}
  }
  if(ddg.length) {const u=unit(texts['src/search-engines.js'],'src/search-engines.js');const p=u.nodes.get('completions.dd')?.[0];if(!p?.isObjectExpression()) {diagnostic('ADAPTER_SHAPE','DDG registration must be a literal object',u.file,u.ast.program);}for(const [key,value] of Object.entries({alias:'du',name:'duckduckgo',search:'https://duckduckgo.com/?q=',compl:'https://duckduckgo.com/ac/?q='})) {if(stringProperty(p.node,key,u.file)!==value) {diagnostic('ADAPTER_SHAPE',`Unexpected DDG ${key}`,u.file,p.node);}}const callback=u.nodes.get('completions.dd.callback');if(callback?.length!==1||!t.isFunction(callback[0].node)) {diagnostic('ADAPTER_SHAPE','DDG callback must be one function assignment',u.file,callback?.[0]?.node??u.ast.program);}roots.push({file:u.file,symbol:'completions.dd',reason:ddg[0].id},{file:u.file,symbol:'completions.dd.callback',reason:ddg[0].id});}
  if(result.resolvedCapabilities.includes('core.openLink')) {const u=unit(texts['src/actions.js'],'src/actions.js');const implementation=u.nodes.get('actions.openLink');if(implementation?.length!==1||!t.isFunction(implementation[0].node)) {diagnostic('ADAPTER_SHAPE','core.openLink must be one function assignment',u.file,implementation?.[0]?.node??u.ast.program);}roots.push({file:'src/actions.js',symbol:'actions.openLink',reason:'core.openLink'});}
  void profile;
  const analysis=analyzeFixtureModules(texts,roots);
  const done=new Set<string>();for(const featureId of result.resolvedFeatures) {const feature=catalog.entries.find(e=>e.id===featureId)!;if(feature.source==='upstream'||done.has(feature.id)) {continue;}done.add(feature.id);const root=path.resolve(ctx.root,feature.source);const extra=await extensionAnalysis(root,feature.entry,feature.id,read);analysis.nodes.push(...extra.nodes);analysis.edges.push(...extra.edges);analysis.components.push(...extra.components);analysis.optimizationDebt.push(...extra.optimizationDebt);}
  analysis.nodes.sort((a,b)=>a.id.localeCompare(b.id));return analysis;
}

function strongComponents(ids:string[],edges:{from:string;to:string}[]):string[][] {
 const remaining=new Set(ids),out:string[][]=[];
 function reaches(from:string,to:string,seen=new Set<string>()):boolean {if(from===to){return true;}if(seen.has(from)){return false;}seen.add(from);return edges.filter(e=>e.from===from).some(e=>reaches(e.to,to,seen));}
 for(const id of ids){if(!remaining.has(id)){continue;}const component=ids.filter(other=>remaining.has(other)&&reaches(id,other)&&reaches(other,id)).sort();for(const member of component){remaining.delete(member);}out.push(component);}return out.sort((a,b)=>a[0].localeCompare(b[0]));
}

function checkRegistrationCall(p:P,file:string):void {const c=chain(p.node.callee);if(!c){return;}const forbidden=new Set(['mapkey','map','addSearchAlias','addSearchAliasX','unmap','removeSearchAlias']);if(!p.scope.getBinding(c.root)&&(forbidden.has(c.root)||c.root==='api'&&forbidden.has(c.members[0]))){diagnostic('EXTENSION_SELF_REGISTRATION','Extension self-registration is unsupported',file,p.node);}}

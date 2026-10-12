import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workspace} from '../dist-tool/input.js';
import {readFileSync,statSync,existsSync} from 'node:fs';
const projectPath=fileURLToPath(new URL('../',import.meta.url));
const gitPath=path.join(projectPath,'.git');
const repoRoot=!existsSync(gitPath)||statSync(gitPath).isDirectory()?projectPath:path.resolve(path.dirname(readFileSync(gitPath,'utf8').trim().replace(/^gitdir: /,'')),'../..');
export const upstream=process.env.SKCB_TEST_UPSTREAM??path.resolve(repoRoot,'../surfingkeys-conf');
export const integrationAvailable=existsSync(path.join(upstream,'.git'));
export const project=fileURLToPath(new URL('../',import.meta.url));
export async function fixture(integration=false,nesting=0) {
  await mkdir(path.join(project,'.cache'),{recursive:true});
  const base=await mkdtemp(path.join(project,'.cache/test-'));const root=path.join(base,...Array.from({length:nesting},()=> 'nested'));await mkdir(root,{recursive:true});await mkdir(path.join(root,'profiles'));await mkdir(path.join(root,'extension'));await mkdir(path.join(root,'upstream'));
  const write=async (relative:string,value:unknown)=>writeFile(path.join(root,relative),typeof value==='string'?value:JSON.stringify(value));
  await write('surfingkeys.workspace.json',{schemaVersion:1,upstream:{path:integration?upstream:'upstream',adapter:'b0o-v1'},extensions:['./extension'],profilesDir:'profiles',outDir:'dist'});
  await write('extension/selective.json',{schemaVersion:1,namespace:'notes',entries:{'actions.notes':{entry:'entry.js',requires:['upstream/search-engines.ddg'],capabilities:['core.openLink'],contributions:[{id:'home',kind:'mapkey',alias:'h',domain:'notes.example.com'}]},'search-engines.notes':{entry:'entry.js',contributions:[{id:'search',kind:'search',alias:'du',name:'Notes',search:'https://notes.example/search'}]}}});
  await write('extension/entry.js',"export default () => ({callbacks:{home: () => window.location.assign('https://notes.example')}});");
  await write('profiles/common.json',{schemaVersion:1,id:'common',abstract:true,selectAdd:['upstream/search-engines.ddg'],settings:{defaultSearchEngine:'du',theme:{one:1}},leaders:{site:'s'}});
  await write('profiles/personal.json',{schemaVersion:1,id:'personal',extends:'common.json',selectAdd:['notes/actions.notes']});
  await write('profiles/work.json',{schemaVersion:1,id:'work',extends:'common.json',selectRemove:['upstream/search-engines.ddg'],unsetSettings:['theme','defaultSearchEngine']});
  return {root,write,ctx:await workspace(path.join(root,'surfingkeys.workspace.json')),cleanup:()=>rm(base,{recursive:true,force:true})};
}

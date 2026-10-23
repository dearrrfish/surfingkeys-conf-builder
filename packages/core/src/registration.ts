import {fail} from './input.js';
import type {Contribution,EffectiveProfile} from './types.js';
export type ActiveContribution=Contribution&{featureId:string};
export interface Registration {id:string;featureId:string;kind:Contribution['kind'];keys:string[];domain:string;pattern?:string;contribution:ActiveContribution}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function registration(c:ActiveContribution,p:EffectiveProfile):Registration {
 const domain=(c.kind!=='mapkey'&&c.kind!=='omnibar')?'global':c.domain??'global';
 const keys=c.kind==='search'?[`${p.leaders.search}${c.alias}`,`c${p.leaders.search}${c.alias}`]:[`${(c.kind==='mapkey'||c.kind==='omnibar')?(c.leader??(domain==='global'?'':p.leaders.site)):''}${c.alias}`];
 return {id:c.id,featureId:c.featureId,kind:c.kind,keys,domain,...(domain!=='global'?{pattern:`^https?://(?:[a-zA-Z0-9-]+\\.)*${escape(domain)}(?::[0-9]+)?(?=[/?#]|$)${c.path?`(?:${c.path})`:''}`} :{}),contribution:c};
}
export function overlaps(a:Registration,b:Registration):boolean {return a.domain==='global'||b.domain==='global'||a.domain===b.domain||a.domain.endsWith(`.${b.domain}`)||b.domain.endsWith(`.${a.domain}`);}
export function registrationConflict(a:Contribution,b:Contribution,p:EffectiveProfile):boolean {const x=registration({...a,featureId:''},p),y=registration({...b,featureId:''},p);return overlaps(x,y)&&x.keys.some(k=>y.keys.includes(k))||a.kind==='search'&&b.kind==='search'&&a.alias===b.alias;}
export function registrationPlan(cs:ActiveContribution[],p:EffectiveProfile):{registrations:Registration[];warnings:{code:string;ids:string[];keys:string[]}[]} {
 const registrations=cs.map(c=>registration(c,p));const warnings:{code:string;ids:string[];keys:string[]}[]=[];
 for(let i=0;i<registrations.length;i++){const a=registrations[i];if(a.pattern){try{new RegExp(a.pattern);}catch{fail('DOMAIN_PATTERN_INVALID',`Invalid domain/path pattern for ${a.id}`);}}for(const b of registrations.slice(i+1)){if(registrationConflict(a.contribution,b.contribution,p)){fail('REGISTRATION_CONFLICT',`Conflicting contributions ${a.id} and ${b.id}`);}if(overlaps(a,b)){for(const x of a.keys){for(const y of b.keys){if(x.startsWith(y)||y.startsWith(x)){warnings.push({code:'KEY_PREFIX',ids:[a.id,b.id],keys:[x,y]});}}}}}}
 return {registrations,warnings};
}

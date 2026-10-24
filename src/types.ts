export interface Workspace { schemaVersion: 1; upstream: {path: string; adapter: 'b0o-v1'}; extensions: string[]; profilesDir: string; outDir: string }
export interface Override {target: string; with: string}
export interface SearchEngineItem {name: string; url: string; canIframe?: boolean}
export interface SearchEngineGroup {id: string; name: string; description?: string; leader?: string; mode?: 'tabs' | 'hub' | 'both'; layout?: 'auto' | 'grid' | 'tabs'; engines: (string | SearchEngineItem)[]; hubUrl?: string}
export interface Profile {schemaVersion: 1; id: string; abstract?: boolean; extends?: string; base?: string; selectAdd?: string[]; selectRemove?: string[]; settings?: Record<string, unknown>; unsetSettings?: string[]; leaders?: {site?: string; search?: string}; overrides?: Override[]; searchGroups?: SearchEngineGroup[]}
export interface Contribution {id: string; kind: 'mapkey'|'map'|'search'; alias: string; description?: string; leader?: string; domain?: string; path?: string; target?: string; name?: string; search?: string; compl?: string; favicon?: string; callbackRequired?: boolean}
export interface Entry {entry: string; description?: string; requires?: string[]; capabilities?: string[]; contributions: Contribution[]}
export interface Manifest {schemaVersion: 1; namespace: string; entries: Record<string, Entry>}
export interface Feature extends Entry {id: string; source: string}
export interface Catalog {entries: Feature[]; capabilities: Record<string, unknown>; unsupported: {id: string; reason: string}[]; codeAnalysis: 'pending'}
export interface Context {workspace: Workspace; file: string; root: string; upstream: string; extensions: string[]; profilesDir: string; outDir: string}
export interface EffectiveProfile {id: string; abstract: boolean; base: string; select: string[]; settings: Record<string, unknown>; leaders: {site: string; search: string}; overrides: Override[]; searchGroups?: SearchEngineGroup[]; provenance: Record<string, string>}
export interface Source {root: string; contentHash: string; sha?: string; namespace?: string}
export interface SourcesLock {schemaVersion: 1; digestRule: 'sha256-path-content-v1-private-excluded'; adapterVersion: 'b0o-v1-static-1'; upstream: Source; extensions: Source[]; toolchainHash: string}

export interface CodeNode {id:string;file:string;symbol:string;reasons:string[];range:{start:{line:number;column:number};end:{line:number;column:number}}}
export interface CodeAnalysis {status:"complete";nodes:CodeNode[];edges:{from:string;to:string}[];components:string[][];externalDependencies:string[];optimizationDebt:{file:string;reason:string}[]}

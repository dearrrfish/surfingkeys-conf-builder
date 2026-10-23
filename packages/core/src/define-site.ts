export interface SiteKeyDefinition {
  alias: string;
  description?: string | { en?: string; 'zh-CN'?: string };
  callback: (...args: any[]) => any;
  domain?: string;
  leaderFree?: boolean;
}

export interface SiteDefinition {
  id: string;
  domain?: string;
  description?: string | { en?: string; 'zh-CN'?: string };
  capabilities?: string[];
  secrets?: Record<string, { description?: string; default?: string; required?: boolean }>;
  keys: (services: Record<string, any>) => Record<string, SiteKeyDefinition>;
}

export function defineSite(def: SiteDefinition): SiteDefinition {
  return def;
}

export interface ModuleDefinition {
  id: string;
  namespace: string;
  description?: string | { en?: string; 'zh-CN'?: string };
  entries: Record<string, any>;
}

export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

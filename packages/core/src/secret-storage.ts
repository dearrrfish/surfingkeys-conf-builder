export interface SecretFieldSchema {
  description?: string;
  default?: string;
  required?: boolean;
}

export interface SecretStorageService {
  get(key?: string, defaultValue?: string): string | Record<string, string>;
  set(key: string, value: string): Promise<void>;
  update(values: Record<string, string>): Promise<void>;
}

export const RUNTIME_STORAGE_CODE = `
const skcbSecretStorage = {
  cache: {},
  async init() {
    try {
      if (typeof browser !== 'undefined' && browser?.storage?.local) {
        const res = await browser.storage.local.get('skcbSecrets');
        if (res?.skcbSecrets) this.cache = res.skcbSecrets;
      } else if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local.get(['skcbSecrets'], (res) => {
          if (res?.skcbSecrets) this.cache = res.skcbSecrets;
        });
      } else if (typeof api !== 'undefined' && typeof api.RUNTIME === 'function') {
        api.RUNTIME('getSettings', { key: 'skcbSecrets' }, (res) => {
          if (res?.settings?.skcbSecrets) this.cache = res.settings.skcbSecrets;
        });
      }
    } catch {}
  },
  get(key, defaultValue = "") {
    return key ? (this.cache[key] ?? defaultValue) : this.cache;
  },
  async set(key, value) {
    this.cache[key] = value;
    try {
      if (typeof browser !== 'undefined' && browser?.storage?.local) {
        await browser.storage.local.set({ skcbSecrets: this.cache });
      }
      if (typeof api !== 'undefined' && typeof api.RUNTIME === 'function') {
        api.RUNTIME('updateSettings', { settings: { skcbSecrets: this.cache } });
      }
    } catch {}
  }
};
skcbSecretStorage.init();
`;

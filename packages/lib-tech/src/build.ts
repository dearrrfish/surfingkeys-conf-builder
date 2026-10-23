import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

export async function buildLibTech(): Promise<void> {
  await mkdir(path.join(distDir, 'actions'), {recursive: true});
  await mkdir(path.join(distDir, 'search-engines'), {recursive: true});
  await mkdir(path.join(distDir, 'omnibar'), {recursive: true});
  await mkdir(path.join(distDir, 'utils'), {recursive: true});

  // 1. utils/index.js
  const utilsJs = `export function parseGithubRepo(url = window.location.href) {
  const m = url.match(/^https?:\\/\\/github\\.com\\/([^\\/]+)\\/([^\\/?#]+)/);
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    repoBase: 'https://github.com/' + m[1] + '/' + m[2]
  };
}
export default () => ({ callbacks: {} });
`;
  await writeFile(path.join(distDir, 'utils/index.js'), utilsJs, 'utf8');

  // 2. actions/github.js
  const githubActionsJs = `import { parseGithubRepo } from '../utils/index.js';

export default (services) => {
  const openRepoPage = (subpath) => {
    const info = parseGithubRepo();
    if (info) {
      window.location.assign(info.repoBase + subpath);
    }
  };

  return {
    callbacks: {
      'actions': () => openRepoPage('/actions'),
      'commits': () => openRepoPage('/commits'),
      'issues': () => openRepoPage('/issues'),
      'pulls': () => openRepoPage('/pulls'),
      'repo': () => openRepoPage('/'),
      'settings': () => openRepoPage('/settings'),
      'wiki': () => openRepoPage('/wiki'),
      'security': () => openRepoPage('/security'),
      'open-from-clipboard': () => {
        if (navigator.clipboard) {
          navigator.clipboard.readText().then((text) => {
            const trimmed = text.trim();
            if (trimmed) {
              window.open('https://github.com/' + trimmed, '_blank');
            }
          });
        }
      }
    }
  };
};
`;
  await writeFile(path.join(distDir, 'actions/github.js'), githubActionsJs, 'utf8');

  // 3. search-engines/sspai.js
  const sspaiSearchJs = `export default () => ({
  callbacks: {
    'article': (response) => [],
    'tag': (response) => []
  }
});
`;
  await writeFile(path.join(distDir, 'search-engines/sspai.js'), sspaiSearchJs, 'utf8');

  // 4. search-engines/github.js
  const githubSearchJs = `export default () => ({
  callbacks: {
    'search': (response) => {
      try {
        const data = JSON.parse(response.text);
        return data?.items?.map(item => '[' + item.stargazers_count + '★] ' + item.full_name) ?? [];
      } catch {
        return [];
      }
    }
  }
});
`;
  await writeFile(path.join(distDir, 'search-engines/github.js'), githubSearchJs, 'utf8');

  // 5. search-engines/searx.js
  const searxJs = `export default () => ({
  callbacks: {
    'search': (response) => []
  }
});
`;
  await writeFile(path.join(distDir, 'search-engines/searx.js'), searxJs, 'utf8');

  // 6. omnibar/github.js
  const omnibarGhJs = `export default (services) => ({
  callbacks: {
    'omnibar': () => {
      const info = (typeof window !== 'undefined') ? window.location.href : '';
      console.log('GitHub Quick Jump Omnibar:', info);
    }
  }
});
`;
  await writeFile(path.join(distDir, 'omnibar/github.js'), omnibarGhJs, 'utf8');

  // 7. selective.json
  const selective = {
    schemaVersion: 1,
    namespace: 'tech',
    entries: {
      'actions.github': {
        entry: 'actions/github.js',
        description: {
          en: 'Enhanced GitHub repository navigation and clipboard opener',
          'zh-CN': 'GitHub 深度导航与剪贴板快速跳转'
        },
        requires: ['tech/utils.index'],
        capabilities: ['core.openLink', 'core.clipboard'],
        contributions: [
          {
            id: 'actions',
            alias: 'A',
            description: {
              en: 'Open repository Actions page',
              'zh-CN': '打开仓库 Actions'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'commits',
            alias: 'C',
            description: {
              en: 'Open repository Commits page',
              'zh-CN': '打开仓库提交历史'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'issues',
            alias: 'I',
            description: {
              en: 'Open repository Issues page',
              'zh-CN': '打开仓库 Issues'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'pulls',
            alias: 'P',
            description: {
              en: 'Open repository Pull Requests page',
              'zh-CN': '打开仓库 Pull Requests'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'repo',
            alias: 'R',
            description: {
              en: 'Open repository root page',
              'zh-CN': '打开仓库主页'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'settings',
            alias: 'S',
            description: {
              en: 'Open repository Settings page',
              'zh-CN': '打开仓库设置'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'wiki',
            alias: 'W',
            description: {
              en: 'Open repository Wiki page',
              'zh-CN': '打开仓库 Wiki'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'security',
            alias: 'X',
            description: {
              en: 'Open repository Security page',
              'zh-CN': '打开仓库安全概览'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'open-from-clipboard',
            alias: '\\cgh',
            description: {
              en: 'Open GitHub owner/repo from clipboard',
              'zh-CN': '从剪贴板打开 GitHub 仓库'
            },
            kind: 'mapkey',
            domain: 'global',
            callbackRequired: true
          }
        ]
      },
      'search-engines.sspai': {
        entry: 'search-engines/sspai.js',
        description: {
          en: 'sspai article and tag search engines',
          'zh-CN': '少数派文章与标签搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'article',
            kind: 'search',
            alias: 'ssp',
            name: 'sspai',
            search: 'https://sspai.com/search/post/',
            callbackRequired: true,
            description: {
              en: 'sspai article search',
              'zh-CN': '少数派文章搜索'
            }
          },
          {
            id: 'tag',
            kind: 'search',
            alias: 'sspt',
            name: 'sspai-tag',
            search: 'https://sspai.com/tag/',
            callbackRequired: true,
            description: {
              en: 'sspai tag search',
              'zh-CN': '少数派标签搜索'
            }
          }
        ]
      },
      'search-engines.github': {
        entry: 'search-engines/github.js',
        description: {
          en: 'GitHub search with star completions',
          'zh-CN': 'GitHub 搜索 (含 Star 星标补全)'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'gh',
            name: 'github',
            search: 'https://github.com/search?q=',
            compl: 'https://api.github.com/search/repositories?q=',
            callbackRequired: true,
            description: {
              en: 'GitHub search',
              'zh-CN': 'GitHub 搜索'
            }
          }
        ]
      },
      'search-engines.searx': {
        entry: 'search-engines/searx.js',
        description: {
          en: 'SearXNG metasearch engine',
          'zh-CN': 'SearXNG 隐私元搜索引擎'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'sx',
            name: 'searxng',
            search: 'https://searx.be/search?q=',
            callbackRequired: true,
            description: {
              en: 'SearXNG search',
              'zh-CN': 'SearXNG 搜索'
            }
          }
        ]
      },
      'omnibar.github': {
        entry: 'omnibar/github.js',
        description: {
          en: 'GitHub repository quick jump Omnibar action',
          'zh-CN': 'GitHub 仓库快捷跳转 Omnibar'
        },
        requires: ['tech/utils.index'],
        capabilities: ['core.omnibar'],
        contributions: [
          {
            id: 'omnibar',
            alias: 'ogh',
            description: {
              en: 'Open GitHub Omnibar quick jump',
              'zh-CN': '呼出 GitHub 仓库快捷跳转'
            },
            kind: 'omnibar',
            callbackRequired: true
          }
        ]
      },
      'utils.index': {
        entry: 'utils/index.js',
        description: {
          en: 'Tech and repository utility helpers',
          'zh-CN': '科技向站点通用辅助函数 (parseGithubRepo 等)'
        },
        requires: [],
        capabilities: [],
        contributions: []
      }
    }
  };

  await writeFile(path.join(distDir, 'selective.json'), JSON.stringify(selective, null, 2) + '\n', 'utf8');

  // 8. index.js & index.d.ts
  const indexJs = `import selective from './selective.json' with { type: 'json' };
export * from './utils/index.js';
export { selective };
export default selective;
`;
  const indexDts = `export declare function parseGithubRepo(url?: string): { owner: string; repo: string; repoBase: string } | null;
export declare const selective: Record<string, unknown>;
export default selective;
`;
  await writeFile(path.join(distDir, 'index.js'), indexJs, 'utf8');
  await writeFile(path.join(distDir, 'index.d.ts'), indexDts, 'utf8');
}

if (process.argv[1] && (process.argv[1].endsWith('build.js') || process.argv[1].endsWith('build.ts'))) {
  buildLibTech()
    .then(() => console.log('✅ @skcb/lib-tech build completed.'))
    .catch((err) => {
      console.error('❌ @skcb/lib-tech build failed:', err);
      process.exit(1);
    });
}

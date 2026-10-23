import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

export async function buildLibProd(): Promise<void> {
  await mkdir(path.join(distDir, 'actions'), {recursive: true});
  await mkdir(path.join(distDir, 'search-engines'), {recursive: true});

  // 1. actions/gmail.js
  const gmailJs = `export default (services) => {
  const goTo = (dest) => {
    const map = {
      'INBOX': '',
      'STARRED': '?s=r',
      'TRASH': '?s=t',
      'CONTACTS': '?v=cl'
    };
    const query = map[dest] ?? '';
    const m = window.location.pathname.match(/^(\\/mail\\/u\\/\\d+\\/h\\/\\w+\\/)/);
    if (m) {
      window.location.assign(m[1] + query);
    }
  };

  const applyAction = (actionVal) => {
    const ab = document.querySelector('form[name="f"]');
    if (!ab) return;
    const sl = ab.querySelector('select[name="tact"]');
    const go = ab.querySelector('input[type="submit"][name="nvp_bu_ac"]');
    if (sl && go) {
      sl.value = actionVal;
      go.click();
    }
  };

  return {
    callbacks: {
      'go-to-inbox': () => goTo('INBOX'),
      'go-to-starred': () => goTo('STARRED'),
      'go-to-trash': () => goTo('TRASH'),
      'go-to-contacts': () => goTo('CONTACTS'),
      'select-all': () => {
        const boxes = document.querySelectorAll('input[type="checkbox"][name="t"]');
        boxes.forEach((b) => { b.checked = true; });
      },
      'select-none': () => {
        const boxes = document.querySelectorAll('input[type="checkbox"][name="t"]');
        boxes.forEach((b) => { b.checked = false; });
      },
      'archive': () => applyAction('arch'),
      'delete': () => applyAction('tr')
    }
  };
};
`;
  await writeFile(path.join(distDir, 'actions/gmail.js'), gmailJs, 'utf8');

  // 2. actions/pinboard.js
  const pinboardJs = `export default (services) => ({
  callbacks: {
    'add-page': () => {
      const url = encodeURIComponent(window.location.href);
      const title = encodeURIComponent(document.title || '');
      window.open('https://pinboard.in/add?url=' + url + '&title=' + title, '_blank');
    },
    'search-page': () => {
      const url = encodeURIComponent(window.location.href);
      window.open('https://pinboard.in/search/?query=' + url, '_blank');
    },
    'random-unread': () => {
      window.open('https://pinboard.in/random/?type=unread', '_blank');
    }
  }
});
`;
  await writeFile(path.join(distDir, 'actions/pinboard.js'), pinboardJs, 'utf8');

  // 3. search-engines/pinboard.js
  const pinboardSearchJs = `export default () => ({
  callbacks: {
    'search': (response) => [],
    'tag': (response) => []
  }
});
`;
  await writeFile(path.join(distDir, 'search-engines/pinboard.js'), pinboardSearchJs, 'utf8');

  // 4. selective.json
  const selective = {
    schemaVersion: 1,
    namespace: 'prod',
    entries: {
      'actions.gmail': {
        entry: 'actions/gmail.js',
        description: {
          en: 'Gmail HTML view keyboard shortcuts and folder navigation',
          'zh-CN': 'Gmail HTML 视图快捷操作与文件夹快速跳转'
        },
        requires: [],
        capabilities: ['core.clickElement'],
        contributions: [
          {
            id: 'go-to-inbox',
            alias: 'gi',
            description: {
              en: 'Go to Inbox',
              'zh-CN': '跳转至收件箱'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'go-to-starred',
            alias: 'gs',
            description: {
              en: 'Go to Starred',
              'zh-CN': '跳转至已加星标'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'go-to-trash',
            alias: 'gt',
            description: {
              en: 'Go to Trash',
              'zh-CN': '跳转至回收站'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'go-to-contacts',
            alias: 'gC',
            description: {
              en: 'Go to Contacts',
              'zh-CN': '跳转至通讯录'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'select-all',
            alias: '*a',
            description: {
              en: 'Select all conversations',
              'zh-CN': '全选会话'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'select-none',
            alias: '*n',
            description: {
              en: 'Deselect all conversations',
              'zh-CN': '取消全选'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'archive',
            alias: 'e',
            description: {
              en: 'Archive selected conversations',
              'zh-CN': '归档所选会话'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          },
          {
            id: 'delete',
            alias: '#',
            description: {
              en: 'Delete selected conversations',
              'zh-CN': '删除所选会话'
            },
            kind: 'mapkey',
            domain: 'mail.google.com',
            path: '/mail/u/\\d+/h/\\w+/\\?&',
            callbackRequired: true
          }
        ]
      },
      'actions.pinboard': {
        entry: 'actions/pinboard.js',
        description: {
          en: 'Pinboard bookmarking and reading list quick keys',
          'zh-CN': 'Pinboard 书签保存与阅读清单快速操作'
        },
        requires: [],
        capabilities: ['core.openLink', 'core.secretStorage'],
        contributions: [
          {
            id: 'add-page',
            alias: 'pA',
            description: {
              en: 'Add current page to Pinboard',
              'zh-CN': '将当前页面添加至 Pinboard'
            },
            kind: 'mapkey',
            domain: 'global',
            callbackRequired: true
          },
          {
            id: 'search-page',
            alias: 'pS',
            description: {
              en: 'Search existing bookmark of current page in Pinboard',
              'zh-CN': '在 Pinboard 中搜索当前页面'
            },
            kind: 'mapkey',
            domain: 'global',
            callbackRequired: true
          },
          {
            id: 'random-unread',
            alias: 'prr',
            description: {
              en: 'Open random unread item from Pinboard',
              'zh-CN': '打开随机未读书签'
            },
            kind: 'mapkey',
            domain: 'global',
            callbackRequired: true
          }
        ]
      },
      'search-engines.pinboard': {
        entry: 'search-engines/pinboard.js',
        description: {
          en: 'Pinboard personal bookmarks and tags search',
          'zh-CN': 'Pinboard 书签与标签搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'pb',
            name: 'pinboard',
            search: 'https://pinboard.in/search/?query=',
            callbackRequired: true,
            description: {
              en: 'Pinboard search',
              'zh-CN': 'Pinboard 书签搜索'
            }
          },
          {
            id: 'tag',
            kind: 'search',
            alias: 'pbt',
            name: 'pinboard-tag',
            search: 'https://pinboard.in/t:',
            callbackRequired: true,
            description: {
              en: 'Pinboard tag search',
              'zh-CN': 'Pinboard 标签搜索'
            }
          }
        ]
      }
    }
  };

  await writeFile(path.join(distDir, 'selective.json'), JSON.stringify(selective, null, 2) + '\n', 'utf8');

  // 5. index.js & index.d.ts
  const indexJs = `import selective from './selective.json' with { type: 'json' };
export { selective };
export default selective;
`;
  const indexDts = `export declare const selective: Record<string, unknown>;
export default selective;
`;
  await writeFile(path.join(distDir, 'index.js'), indexJs, 'utf8');
  await writeFile(path.join(distDir, 'index.d.ts'), indexDts, 'utf8');
}

if (process.argv[1] && (process.argv[1].endsWith('build.js') || process.argv[1].endsWith('build.ts'))) {
  buildLibProd()
    .then(() => console.log('✅ @skcb/lib-prod build completed.'))
    .catch((err) => {
      console.error('❌ @skcb/lib-prod build failed:', err);
      process.exit(1);
    });
}

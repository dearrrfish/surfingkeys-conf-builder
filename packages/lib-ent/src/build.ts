import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

export async function buildLibEnt(): Promise<void> {
  await mkdir(path.join(distDir, 'actions'), {recursive: true});
  await mkdir(path.join(distDir, 'search-engines'), {recursive: true});

  // 1. actions/bilibili.js
  const bilibiliJs = `export default (services) => ({
  callbacks: {
    'fullscreen-web': () => {
      const el = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-web, .squirtle-video-pagefullscreen');
      el?.click();
    },
    'fullscreen': () => {
      const el = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-full, .squirtle-video-fullscreen');
      el?.click();
    },
    'like': () => {
      const el = document.querySelector('#arc_toolbar_report .like, .video-like');
      el?.click();
    },
    'coin': () => {
      const el = document.querySelector('#arc_toolbar_report .coin, .video-coin');
      el?.click();
    },
    'collect': () => {
      const el = document.querySelector('#arc_toolbar_report .collect, .video-fav');
      el?.click();
    },
    'danmaku': () => {
      const el = document.querySelector('.bui-danmaku-switch-input, .bpx-player-dm-switch');
      el?.click();
    }
  }
});
`;
  await writeFile(path.join(distDir, 'actions/bilibili.js'), bilibiliJs, 'utf8');

  // 2. search-engines/bilibili.js
  const bilibiliSearchJs = `export default () => ({
  callbacks: {
    'search': (response) => {
      try {
        const data = JSON.parse(response.text);
        return data?.result?.tag?.map(item => item.value) ?? [];
      } catch {
        return [];
      }
    }
  }
});
`;
  await writeFile(path.join(distDir, 'search-engines/bilibili.js'), bilibiliSearchJs, 'utf8');

  // 3. actions/youtube.js
  const youtubeJs = `export default (services) => ({
  callbacks: {
    'open-piped': () => {
      const current = window.location.href;
      const m = current.match(/^https?:\\/\\/(?:www\\.)?youtube\\.com\\/watch\\?(.*)$/);
      if (!m) return;
      const q = new URLSearchParams(m[1]);
      const vid = q.get('v');
      if (vid) {
        window.open('https://piped.video/watch?v=' + vid, '_blank');
      }
    },
    'open-invidious': () => {
      const current = window.location.href;
      const m = current.match(/^https?:\\/\\/(?:www\\.)?youtube\\.com\\/watch\\?(.*)$/);
      if (!m) return;
      const q = new URLSearchParams(m[1]);
      const vid = q.get('v');
      if (vid) {
        window.open('https://yewtu.be/watch?v=' + vid, '_blank');
      }
    }
  }
});
`;
  await writeFile(path.join(distDir, 'actions/youtube.js'), youtubeJs, 'utf8');

  // 4. actions/twitter.js
  const twitterJs = `export default (services) => ({
  callbacks: {
    'open-nitter': () => {
      const current = window.location.href;
      const nitterUrl = current.replace(/https?:\\/\\/(?:www\\.)?(?:twitter\\.com|x\\.com)/, 'https://nitter.net');
      window.open(nitterUrl, '_blank');
    }
  }
});
`;
  await writeFile(path.join(distDir, 'actions/twitter.js'), twitterJs, 'utf8');

  // 5. selective.json
  const selective = {
    schemaVersion: 1,
    namespace: 'ent',
    entries: {
      'actions.bilibili': {
        entry: 'actions/bilibili.js',
        description: {
          en: 'Bilibili video player controls and interactions',
          'zh-CN': '哔哩哔哩视频播放控制与快捷交互'
        },
        requires: [],
        capabilities: ['core.clickElement'],
        contributions: [
          {
            id: 'fullscreen-web',
            alias: 'f',
            description: {
              en: 'Toggle video windowed fullscreen',
              'zh-CN': '网页全屏'
            },
            kind: 'mapkey',
            domain: 'bilibili.com',
            callbackRequired: true
          },
          {
            id: 'fullscreen',
            alias: 'F',
            description: {
              en: 'Toggle video fullscreen',
              'zh-CN': '全屏模式'
            },
            kind: 'mapkey',
            domain: 'bilibili.com',
            callbackRequired: true
          },
          {
            id: 'like',
            alias: 'l',
            description: {
              en: 'Like the video',
              'zh-CN': '点赞视频'
            },
            kind: 'mapkey',
            domain: 'bilibili.com',
            callbackRequired: true
          },
          {
            id: 'coin',
            alias: 'c',
            description: {
              en: 'Send coins',
              'zh-CN': '投币'
            },
            kind: 'mapkey',
            domain: 'bilibili.com',
            callbackRequired: true
          },
          {
            id: 'collect',
            alias: 'b',
            description: {
              en: 'Bookmark/Favorite the video',
              'zh-CN': '收藏视频'
            },
            kind: 'mapkey',
            domain: 'bilibili.com',
            callbackRequired: true
          },
          {
            id: 'danmaku',
            alias: 'd',
            description: {
              en: 'Toggle danmaku',
              'zh-CN': '开关弹幕'
            },
            kind: 'mapkey',
            domain: 'bilibili.com',
            callbackRequired: true
          }
        ]
      },
      'search-engines.bilibili': {
        entry: 'search-engines/bilibili.js',
        description: {
          en: 'Bilibili search engine',
          'zh-CN': '哔哩哔哩搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'bv',
            name: 'bilibili',
            search: 'https://search.bilibili.com/all?keyword=',
            compl: 'https://s.search.bilibili.com/main/suggest?term=',
            callbackRequired: true,
            description: {
              en: 'Bilibili video search',
              'zh-CN': '哔哩哔哩视频搜索'
            }
          }
        ]
      },
      'actions.youtube': {
        entry: 'actions/youtube.js',
        description: {
          en: 'YouTube privacy enhancements (Piped & Invidious)',
          'zh-CN': 'YouTube 隐私镜像快捷跳转 (Piped/Invidious)'
        },
        requires: [],
        capabilities: ['core.openLink'],
        contributions: [
          {
            id: 'open-piped',
            alias: 'gp',
            description: {
              en: 'Open current video in Piped',
              'zh-CN': '在 Piped 隐私镜像中打开当前视频'
            },
            kind: 'mapkey',
            domain: 'youtube.com',
            callbackRequired: true
          },
          {
            id: 'open-invidious',
            alias: 'gl',
            description: {
              en: 'Open current video in Invidious',
              'zh-CN': '在 Invidious 隐私镜像中打开当前视频'
            },
            kind: 'mapkey',
            domain: 'youtube.com',
            callbackRequired: true
          }
        ]
      },
      'actions.twitter': {
        entry: 'actions/twitter.js',
        description: {
          en: 'Twitter/X Nitter instance quick navigation',
          'zh-CN': 'Twitter/X 在 Nitter 实例中打开'
        },
        requires: [],
        capabilities: ['core.openLink'],
        contributions: [
          {
            id: 'open-nitter',
            alias: 'N',
            description: {
              en: 'Open current tweet/profile in Nitter',
              'zh-CN': '在 Nitter 镜像中打开当前推文'
            },
            kind: 'mapkey',
            domain: 'x.com',
            callbackRequired: true
          }
        ]
      }
    }
  };

  await writeFile(path.join(distDir, 'selective.json'), JSON.stringify(selective, null, 2) + '\n', 'utf8');

  // 6. index.js & index.d.ts
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
  buildLibEnt()
    .then(() => console.log('✅ @skcb/lib-ent build completed.'))
    .catch((err) => {
      console.error('❌ @skcb/lib-ent build failed:', err);
      process.exit(1);
    });
}

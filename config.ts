import type { ExtensionConfig } from '@any-listen/extension-kit/config'

import pkg from './package.json' with { type: 'json' }

const config: ExtensionConfig = {
  id: 'gdstudio',
  name: 'GD音乐台',
  description: '使用GDStudio插件接口实现的音乐插件，支持网易云音乐、酷我音乐、JOOX和QQ音乐等多个平台的音乐搜索、播放和歌词显示功能。',
  version: pkg.version,
  homepage: pkg.homepage,
  license: pkg.license,
  author: 'e^iπ=-1',
  target_engine: '1.1.2',
  categories: [],
  tags: [],
  download_url_template: 'https://github.com/morpheus315/gdstudio-repo/releases/download/v{version}',
  icon: './resources/icon.png',
  grant: ['internet', 'player', 'music_list'],
  contributes: {
    resource: [
      {
        id: 'netease',
        name: '网易云音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'kuwo',
        name: '酷我音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'joox',
        name: 'JOOX',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'tencent',
        name: 'QQ音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
    ],
  },
}

export default config

import type { ExtensionConfig } from '@any-listen/extension-kit/config'

import pkg from './package.json' with { type: 'json' }

const config: ExtensionConfig = {
  id: 'gdstudio',
  name: 'GD音乐台',
  description: '使用GDStudio插件接口实现的音乐插件，支持网易云音乐、QQ音乐、酷我音乐、JOOX、TIDAL、QOBUZ、哔哩哔哩、Apple Music、YouTube Music、Spotify等多个平台的音乐搜索、播放和歌词显示功能。',
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
        name: 'gd-网易云音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'kuwo',
        name: 'gd-酷我音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'joox',
        name: 'gd-JOOX',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'tencent',
        name: 'gd-QQ音乐',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'tidal',
        name: 'gd-TIDAL',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'qobuz',
        name: 'gd-QOBUZ',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'bilibili',
        name: 'gd-哔哩哔哩',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'apple',
        name: 'gd-Apple Music',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'ytmusic',
        name: 'gd-YouTube Music',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
      {
        id: 'spotify',
        name: 'gd-Spotify',
        resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
      },
    ],
    settings: [
      {
        field: 'preloadQualityOnSearch',
        name: '搜索时预加载音质',
        description: '仅影响网易云音乐、酷我音乐、JOOX、哔哩哔哩四个主 API 音源(org 音源为防限流始终不在搜索时预加载)。',
        type: 'boolean',
        default: true,
      },
      {
        field: 'signServerUrl',
        name: '签名服务器地址',
        description: 'gdstudio-server 的地址,不要带 /sign 路径,例如 https://your-domain.example。QQ音乐、TIDAL、QOBUZ、Apple Music、YouTube Music、Spotify 音源必须配置此项后才可用。',
        type: 'input',
        default: '',
      },
      {
        field: 'signKey',
        name: '签名 token',
        description: '签名服务器 /sign 端点的 SIGN_KEY(Bearer token)',
        type: 'input',
        default: '',
      },
    ],
  },
}

export default config

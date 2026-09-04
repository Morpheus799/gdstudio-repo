import type { ExtensionConfig } from '@any-listen/extension-kit/config'

import pkg from './package.json' with { type: 'json' }

const sources = [
  ['netease', 'gd-网易云音乐'],
  ['kuwo', 'gd-酷我音乐'],
  ['joox', 'gd-JOOX'],
  ['tencent', 'gd-QQ音乐'],
  ['tidal', 'gd-TIDAL'],
  ['qobuz', 'gd-QOBUZ'],
  ['bilibili', 'gd-哔哩哔哩'],
  ['apple', 'gd-Apple Music'],
  ['ytmusic', 'gd-YouTube Music'],
  ['spotify', 'gd-Spotify'],
] as const

type ResourceContribution = NonNullable<NonNullable<ExtensionConfig['contributes']>['resource']>[number]

const resources: ResourceContribution[] = [
  ...sources.map<ResourceContribution>(([id, name]) => ({
    id: `gd-${id}`,
    name,
    resource: ['musicSearch', 'musicUrl', 'musicPic', 'musicLyric'],
  })),
  ...sources.map<ResourceContribution>(([id]) => ({
    id,
    name: 'GD音乐台旧数据迁移',
    resource: ['musicUrl'],
  })),
]

const config: ExtensionConfig = {
  id: 'gdstudio',
  name: 'GD音乐台',
  description:
    '使用GDStudio插件接口实现的音乐插件，支持网易云音乐、QQ音乐、酷我音乐、JOOX、TIDAL、QOBUZ、哔哩哔哩、Apple Music、YouTube Music、Spotify等多个平台的音乐搜索、播放和歌词显示功能。',
  version: pkg.version,
  homepage: pkg.homepage,
  license: pkg.license,
  author: 'e^iπ=-1',
  target_engine: '1.3.1',
  categories: [],
  tags: [],
  download_url_template: 'https://github.com/morpheus315/gdstudio-repo/releases/download/v{version}',
  icon: './resources/icon.png',
  grant: ['internet', 'player', 'music_list'],
  contributes: {
    resource: resources,
    commands: [
      {
        command: 'migrateLegacyData',
        name: '迁移旧版歌单数据',
        description: '将 Any Listen 备份中的旧版 GD音乐台歌曲转换为新版标识。',
      },
      {
        command: 'showMigrationReport',
        name: '查看迁移报告',
        description: '查看最近一次歌单迁移的结果。',
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
        description:
          'gdstudio-server 的地址,不要带 /sign 路径,例如 https://your-domain.example。QQ音乐、TIDAL、QOBUZ、Apple Music、YouTube Music、Spotify 音源必须配置此项后才可用。',
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

/** What a cloud drive link needs before it downloads: the referer its CDN expects, mostly. */

export interface LinkHint {
  provider: string;
  /** The `Referer` its download endpoint checks, when it checks one. */
  referer: string | null;
  /** A share page rather than a file: the app cannot resolve it without the site's own API. */
  sharePage: boolean;
  note: string;
}

interface Rule {
  host: RegExp;
  provider: string;
  referer: string | null;
  sharePage?: RegExp;
  note?: string;
}

const RULES: Rule[] = [
  {
    host: /(^|\.)(aliyundrive|alipan)\.com$/,
    provider: "阿里云盘",
    referer: "https://www.alipan.com/",
    sharePage: /\/s\/[^/]+/,
    note: "分享页链接请先在网页里点下载，或在扩展里取嗅探到的直链。",
  },
  {
    host: /(^|\.)123pan\.(com|cn)$|(^|\.)123684\.com$/,
    provider: "123 云盘",
    referer: "https://www.123pan.com/",
  },
  {
    host: /(^|\.)quark\.cn$/,
    provider: "夸克网盘",
    referer: "https://pan.quark.cn/",
    sharePage: /\/s\/[^/]+/,
  },
  {
    host: /(^|\.)baidu\.com$/,
    provider: "百度网盘",
    referer: "https://pan.baidu.com/",
    sharePage: /\/s\/[^/]+/,
    note: "直链需要账号 Cookie；可在「高级」里把 Cookie 作为请求头传入。",
  },
  {
    host: /(^|\.)(lanzou[a-z]?|lanzn)\.com$/,
    provider: "蓝奏云",
    referer: "https://www.lanzou.com/",
    sharePage: /\/[a-z0-9]{6,}$/i,
  },
  {
    host: /(^|\.)115(cdn)?\.com$/,
    provider: "115 网盘",
    referer: "https://115.com/",
  },
  {
    host: /(^|\.)yun\.139\.com$/,
    provider: "移动云盘",
    referer: "https://yun.139.com/",
  },
  {
    host: /(^|\.)(onedrive|1drv)\.(com|ms)$|(^|\.)sharepoint\.com$/,
    provider: "OneDrive",
    referer: null,
    note: "分享链接通常已经带上临时签名，直接下载即可。",
  },
  {
    host: /(^|\.)(dropbox|dropboxusercontent)\.com$/,
    provider: "Dropbox",
    referer: null,
  },
  {
    host: /(^|\.)googleusercontent\.com$|(^|\.)drive\.google\.com$/,
    provider: "Google Drive",
    referer: null,
    note: "大文件会弹“无法扫描病毒”的确认页，先确认一次再复制直链。",
  },
  {
    host: /(^|\.)(pds|pcs|aliyundrive-accelerate)\./,
    provider: "对象存储直链",
    referer: null,
    note: "看起来是 CDN 直链，直接下即可。",
  },
];

export function describeLink(url: string): LinkHint | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  for (const rule of RULES) {
    if (!rule.host.test(host)) continue;
    const sharePage = rule.sharePage ? rule.sharePage.test(parsed.pathname) : false;
    return {
      provider: rule.provider,
      referer: rule.referer,
      sharePage,
      note: sharePage
        ? rule.note ?? "这是分享页而不是文件直链，请从分享页里取得直链。"
        : rule.note ?? "已按服务商要求附加 Referer。",
    };
  }
  return null;
}

export interface WebDAVFile {
  name: string;
  path: string; // 相对/绝对 URL 路径
  isDir: boolean;
  size?: number;
  mtime?: number;
}

// 极其轻量的 WebDAV 协议客户端，不依赖第三方库，直接使用浏览器 fetch
export class WebDAVClient {
  private url: string;
  private authHeader: string;

  constructor(url: string, username?: string, password?: string) {
    // 确保 url 不以斜杠结尾
    this.url = url.endsWith('/') ? url.slice(0, -1) : url;
    
    if (username && password) {
      const creds = btoa(unescape(encodeURIComponent(`${username}:${password}`)));
      this.authHeader = `Basic ${creds}`;
    } else {
      this.authHeader = '';
    }
  }

  // 获取请求头部
  private getHeaders(extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }
    return headers;
  }

  // 1. 测试连接是否成功
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(this.url, {
        method: 'PROPFIND',
        headers: this.getHeaders({
          'Depth': '0',
          'Content-Type': 'application/xml; charset=utf-8'
        })
      });
      return response.status === 207 || response.status === 200 || response.status === 301 || response.status === 405;
    } catch (err) {
      console.error('WebDAV connection failed:', err);
      return false;
    }
  }

  // 2. 浏览指定路径下的目录结构 (Depth: 1)
  async readDir(subPath: string = ''): Promise<WebDAVFile[]> {
    const cleanSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
    const targetUrl = subPath ? `${this.url}${cleanSubPath}` : this.url;

    try {
      const response = await fetch(targetUrl, {
        method: 'PROPFIND',
        headers: this.getHeaders({
          'Depth': '1',
          'Content-Type': 'application/xml; charset=utf-8'
        })
      });

      if (!response.ok && response.status !== 207) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const xmlText = await response.text();
      return this.parseWebDAVXml(xmlText, targetUrl);
    } catch (err) {
      console.error('WebDAV readDir error:', err);
      throw err;
    }
  }

  // 3. 简单的 WebDAV XML 解析器
  private parseWebDAVXml(xmlText: string, baseUrl: string): WebDAVFile[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // WebDAV 的命名空间各网盘实现可能有差异，我们需要兼容多种前缀
    const responses = Array.from(xmlDoc.getElementsByTagNameNS('*', 'response'));
    const files: WebDAVFile[] = [];

    // 获取 baseUrl 的 pathname，用于比对以排除父目录自身
    let baseUriPath = '';
    try {
      baseUriPath = decodeURIComponent(new URL(baseUrl).pathname);
      if (!baseUriPath.endsWith('/')) baseUriPath += '/';
    } catch {
      baseUriPath = baseUrl;
    }

    for (const resNode of responses) {
      const hrefNode = resNode.getElementsByTagNameNS('*', 'href')[0];
      if (!hrefNode) continue;

      let href = decodeURIComponent(hrefNode.textContent || '');
      
      // 如果 href 是完整的 URL，转换为 pathname
      try {
        if (href.startsWith('http://') || href.startsWith('https://')) {
          href = new URL(href).pathname;
        }
      } catch {}

      // 获取显示名
      const propNode = resNode.getElementsByTagNameNS('*', 'prop')[0];
      if (!propNode) continue;

      const displayNameNode = propNode.getElementsByTagNameNS('*', 'displayname')[0];
      let name = displayNameNode ? displayNameNode.textContent || '' : '';

      // 如果没有显示名，从 href 中截取最后一段
      if (!name) {
        const cleanHref = href.endsWith('/') ? href.slice(0, -1) : href;
        name = cleanHref.split('/').pop() || '';
      }

      // 检查是否是文件夹
      const resourceTypeNode = propNode.getElementsByTagNameNS('*', 'resourcetype')[0];
      const isDir = resourceTypeNode 
        ? resourceTypeNode.getElementsByTagNameNS('*', 'collection').length > 0 || href.endsWith('/')
        : href.endsWith('/');

      // 获取文件大小
      const contentLengthNode = propNode.getElementsByTagNameNS('*', 'getcontentlength')[0];
      const size = contentLengthNode ? parseInt(contentLengthNode.textContent || '0', 10) : undefined;

      // 获取修改日期
      const lastModifiedNode = propNode.getElementsByTagNameNS('*', 'getlastmodified')[0];
      const mtime = lastModifiedNode ? new Date(lastModifiedNode.textContent || '').getTime() : undefined;

      // 排除当前被浏览的目录自身 (href 路径与 baseUriPath 相同)
      const cleanHref = href.endsWith('/') ? href : `${href}/`;
      if (cleanHref === baseUriPath || href === baseUriPath) {
        continue;
      }

      files.push({
        name,
        path: href,
        isDir,
        size,
        mtime
      });
    }

    // 过滤出视频文件
    const videoExtensions = ['.mp4', '.webm', '.mkv', '.ogg', '.avi', '.flv'];
    
    const filteredFiles = files.filter(f => {
      if (f.isDir) return true;
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
      return videoExtensions.includes(ext);
    });

    // 排序：文件夹在前，文件在后
    return filteredFiles.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  // 4. 将本地 JSON 配置文件同步到 WebDAV 空间
  async uploadFile(fileName: string, content: string): Promise<boolean> {
    try {
      // 1. 尝试以 PUT 请求创建或覆盖文件
      const response = await fetch(`${this.url}/${fileName}`, {
        method: 'PUT',
        headers: this.getHeaders({
          'Content-Type': 'application/json; charset=utf-8'
        }),
        body: content
      });
      return response.status === 200 || response.status === 201 || response.status === 204;
    } catch (err) {
      console.error('WebDAV upload file failed:', err);
      return false;
    }
  }

  // 5. 从 WebDAV 空间下载本地 JSON 配置文件
  async downloadFile(fileName: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.url}/${fileName}`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      if (response.status === 200) {
        return await response.text();
      }
      return null;
    } catch (err) {
      console.error('WebDAV download file failed:', err);
      return null;
    }
  }
}

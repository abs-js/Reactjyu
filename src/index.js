import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

const PROJECT_ROOT = path.resolve(process.env.REACJYU_ROOT || process.cwd());
let backendState = Object.create(null);
const routes = new Map();
let currentIndexFile = 'public/app.cjy';
const liveReloadClients = new Set();
let serverInstance = null;
let watcherTimer = null;
let lastFileSnapshot = '';
let nextHandlerId = 0;

export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAttributeName(name) {
  return /^[a-zA-Z_:][a-zA-Z0-9:._-]*$/.test(name) && !/^on/i.test(name);
}

function safeURL(value) {
  const string = String(value ?? '').trim();
  if (/^(?:javascript|vbscript|data):/i.test(string)) return '#';
  return string;
}

function serializeStyle(styles) {
  return Object.entries(styles || {}).map(([name, value]) => {
    const cssName = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    if (!/^[a-z-]+$/i.test(cssName)) return '';
    return `${cssName}:${String(value).replace(/[<>"']/g, '')}`;
  }).filter(Boolean).join(';');
}

export class Element {
  constructor(tag = 'div', props = {}) {
    if (!/^[a-z][a-z0-9-]*$/i.test(tag)) throw new TypeError(`Tag HTML inválida: ${tag}`);
    this.tag = tag.toLowerCase();
    this.children = [];
    this.attrs = {};
    this.styles = {};
    this.events = Object.create(null);
    this.onclick = null;
    this.id = null;
    this.text = null;
    if (props && typeof props === 'object') {
      const { children, style, onClick, onclick, text, ...attrs } = props;
      Object.assign(this.attrs, attrs);
      Object.assign(this.styles, style || {});
      if (text !== undefined) this.text = text;
      if (onClick || onclick) this.onclick = onClick || onclick;
      if (children !== undefined) this.append(children);
    }
  }

  append(...items) {
    for (const item of items.flat(Infinity)) {
      if (item !== undefined && item !== null && item !== false) this.children.push(item);
    }
    return this;
  }

  setAttribute(name, value) {
    if (name === 'id') this.id = value;
    else this.attrs[name] = value;
    return this;
  }

  setStyle(name, value) {
    this.styles[name] = value;
    return this;
  }

  on(eventName, callback) {
    if (!/^[a-z]+$/i.test(eventName)) throw new TypeError('Nome de evento inválido.');
    if (typeof callback !== 'function') throw new TypeError('O callback do evento precisa ser uma função.');
    this.events[eventName.toLowerCase()] = callback;
    if (eventName.toLowerCase() === 'click') this.onclick = callback;
    return this;
  }

  toHTML(context = { handlers: [] }) {
    const attrs = [];
    const allAttrs = { ...this.attrs };
    if (this.id != null) allAttrs.id = this.id;
    const style = serializeStyle(this.styles);
    if (style) allAttrs.style = style;

    for (const [name, rawValue] of Object.entries(allAttrs)) {
      if (!safeAttributeName(name) || name.toLowerCase() === 'srcdoc' || rawValue == null || rawValue === false) continue;
      let value = rawValue === true ? '' : rawValue;
      if (/^(href|src|action|formaction|xlink:href)$/i.test(name)) value = safeURL(value);
      attrs.push(value === '' && rawValue === true ? ` ${name}` : ` ${name}="${escapeHTML(value)}"`);
    }

    const handlers = { ...this.events };
    if (typeof this.onclick === 'function') handlers.click = this.onclick;
    const eventAttrs = [];
    for (const [eventName, callback] of Object.entries(handlers)) {
      if (typeof callback !== 'function') continue;
      const id = `rj-${++nextHandlerId}`;
      context.handlers.push({ id, eventName, source: callback.toString() });
      eventAttrs.push(` data-rj-${escapeHTML(eventName)}="${id}"`);
    }

    const kids = [];
    if (this.text !== null) kids.push(escapeHTML(this.text));
    for (const child of this.children) {
      if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') kids.push(escapeHTML(child));
      else if (child && typeof child.toHTML === 'function') kids.push(child.toHTML(context));
      else if (child !== null && child !== undefined && child !== false) kids.push(escapeHTML(String(child)));
    }
    const voidTag = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    return voidTag.has(this.tag)
      ? `<${this.tag}${attrs.join('')}${eventAttrs.join('')}>`
      : `<${this.tag}${attrs.join('')}${eventAttrs.join('')}>${kids.join('')}</${this.tag}>`;
  }
}

export class Button extends Element {
  constructor(props = {}) { super('button', props); }
}
export class Span extends Element {
  constructor(props = {}) { super('span', props); }
}
export class Div extends Element {
  constructor(props = {}) { super('div', props); }
}
export class Paragraph extends Element {
  constructor(props = {}) { super('p', props); }
}
export class Heading extends Element {
  constructor(level = 1, props = {}) {
    if (typeof level === 'object') { props = level; level = props.level || 1; }
    const safeLevel = Math.min(6, Math.max(1, Number(level) || 1));
    super(`h${safeLevel}`, props);
  }
}
export class Input extends Element {
  constructor(props = {}) { super('input', props); }
}
export class Link extends Element {
  constructor(props = {}) { super('a', props); }
}
export class Image extends Element {
  constructor(props = {}) { super('img', props); }
}
export class Form extends Element {
  constructor(props = {}) { super('form', props); }
}
export class List extends Element {
  constructor(props = {}) { super('ul', props); }
}
export class ListItem extends Element {
  constructor(props = {}) { super('li', props); }
}

export const reacjyuLib = {
  Element, Button, Span, Div, Paragraph, Heading, Input, Link, Image, Form, List, ListItem,
  escapeHTML
};
export const CajyuLib = reacjyuLib;

function isInsideProject(fullPath) {
  const relative = path.relative(PROJECT_ROOT, fullPath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveProjectFile(filePath) {
  const full = path.resolve(PROJECT_ROOT, filePath);
  if (full !== PROJECT_ROOT && !isInsideProject(full)) throw new Error('O caminho solicitado sai da pasta do projeto.');
  return full;
}

function escapeScriptJSON(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function appendDevelopmentRuntime(html, handlers) {
  const handlerMap = {};
  for (const entry of handlers) handlerMap[entry.id] = { eventName: entry.eventName, source: entry.source };
  const runtime = `<script>
(() => {
  const handlers = ${escapeScriptJSON(handlerMap)};
  document.addEventListener('click', runEvent, true);
  document.addEventListener('change', runEvent, true);
  document.addEventListener('input', runEvent, true);
  function runEvent(event) {
    const attr = 'data-rj-' + event.type;
    const element = event.target && event.target.closest ? event.target.closest('[' + attr + ']') : null;
    if (!element) return;
    const id = element.getAttribute(attr);
    const entry = handlers[id];
    if (!entry) return;
    try {
      const callback = Function('event', 'element', 'return (' + entry.source + ')(event, element)');
      callback(event, element);
    } catch (error) {
      console.error('[Reacjyu] Erro no evento:', error);
    }
  }
  if (typeof EventSource !== 'undefined') {
    const events = new EventSource('/__reacjyu/events');
    events.addEventListener('reload', (event) => {
      let update = {};
      try { update = JSON.parse(event.data || '{}'); } catch {}
      if (update.cssOnly && Array.isArray(update.files)) {
        const wanted = new Set(update.files.map(file => '/' + file.replace(/^public\\//, '')));
        const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
        const matched = links.filter(link => wanted.has(new URL(link.href, location.href).pathname));
        if (matched.length && matched.length === wanted.size) {
          const cacheKey = Date.now().toString();
          for (const link of matched) {
            const url = new URL(link.href, location.href);
            url.searchParams.set('__reacjyu', cacheKey);
            link.href = url.toString();
          }
          return;
        }
      }
      location.reload();
    });
    events.onerror = () => {};
  }
})();
</script>`;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${runtime}</body>`);
  return `${html}${runtime}`;
}

function transformCajyuForRendering(source) {
  let code = source;
  const importedNames = [];
  code = code.split(/\r?\n/).filter(line => {
    const match = line.match(/^\s*import\s+(\w+)\s+from\s+['"]?([^\s'";]+)['"]?\s*;?\s*$/);
    if (match) {
      importedNames.push({ name: match[1], from: match[2] });
      return false;
    }
    // This first renderer deliberately handles one-line imports only.
    if (/^\s*import\s+/.test(line)) return false;
    return true;
  }).join('\n');

  code = code.replace(/\bexport\s+fn\s+Site\s+(\w+)\s*\{/g, 'function Site($1) {');
  code = code.replace(/\bfn\s+Site\s+(\w+)\s*\{/g, 'function Site($1) {');
  code = code.replace(/\bexport\s+fn\s+(\w+)\s+(\w+)\s*\{/g, 'function $1($2) {');
  code = code.replace(/\bfn\s+(\w+)\s+(\w+)\s*\{/g, 'function $1($2) {');
  code = code.replace(/=\s*fn\s+(\w+)\s*\{/g, '= function($1) {');
  code = code.replace(/=\s*fn\s*\{/g, '= function() {');
  code = code.replace(/\bexport\s+(?=(?:const|let|var|class|function)\b)/g, '');
  return { code, importedNames };
}

function makeErrorPage(title, message) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#222}pre{background:#f3f3f3;padding:16px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>${escapeHTML(title)}</h1><pre>${escapeHTML(message)}</pre><p>Confira o terminal do Reacjyu para mais detalhes.</p></body></html>`;
}

export function renderFile(filePath, stats = {}) {
  let full;
  try { full = resolveProjectFile(filePath); }
  catch (error) { return { html: makeErrorPage('Caminho inválido', error.message), stats }; }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return { html: makeErrorPage('Arquivo não encontrado', filePath), stats };
  }

  const original = fs.readFileSync(full, 'utf8');
  const { code, importedNames } = transformCajyuForRendering(original);
  const bindings = {
    Element, Button, Span, Div, Paragraph, Heading, Input, Link, Image, Form, List, ListItem,
    print: (...args) => console.log('[app]', ...args),
    ...reacjyuLib
  };
  const importParams = [];
  const importValues = [];
  let importError = null;
  for (const entry of importedNames) {
    const libName = entry.from.startsWith('CajyuLibs.') ? entry.from.split('.')[1] : entry.from;
    let value;
    if (libName === 'reacjyu') value = reacjyuLib[entry.name] ?? (entry.name === 'default' ? reacjyuLib : undefined);
    else if (libName === 'serial' && entry.name === 'print') value = (...args) => console.log('[app]', ...args);
    else value = undefined;
    if (value === undefined) {
      importError = new Error(`Importação não suportada pelo renderizador Reacjyu: ${entry.name} de ${entry.from}. A renderização atual aceita CajyuLibs.reacjyu e print de CajyuLibs.serial.`);
      break;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(entry.name)) {
      bindings[entry.name] = value;
      importParams.push(entry.name);
      importValues.push(value);
    }
  }

  try {
    if (importError) throw importError;
    const wrapped = `${code}\n;return typeof Site === 'function' ? Site : (typeof site === 'function' ? site : null);`;
    const params = [...new Set([...Object.keys(bindings), ...importParams])];
    const values = params.map(name => bindings[name] ?? importValues[importParams.indexOf(name)]);
    const factory = new Function(...params, wrapped);
    const Site = factory(...values);
    if (typeof Site !== 'function') throw new Error('Não encontrei `export fn Site stats { ... }` no arquivo.');

    const context = { handlers: [] };
    let result = Site(stats);
    if (result && typeof result.then === 'function') throw new Error('Site(stats) retornou uma Promise; renderização assíncrona ainda não é suportada.');
    let site = result;
    if (Array.isArray(result)) {
      site = result[0];
      if (result[1] && typeof result[1] === 'object') Object.assign(stats, result[1]);
    }

    let html;
    {
      html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reacjyu</title></head><body>';
      if (typeof site === 'string') {
        html += escapeHTML(site);
      } else if (site?.html && Array.isArray(site.html.body)) {
        html += site.html.body.map(item => {
          if (typeof item === 'string' || typeof item === 'number') return escapeHTML(item);
          if (item && typeof item.toHTML === 'function') return item.toHTML(context);
          return '';
        }).join('');
      } else if (site instanceof Element) {
        html += site.toHTML(context);
      } else {
        html += '<p>Nenhum conteúdo gerado. Retorne uma string, um Element ou { html: { body: [...] } }.</p>';
      }
      html += '</body></html>';
    }

    return { html: appendDevelopmentRuntime(html, context.handlers), stats };
  } catch (error) {
    console.error(`[Reacjyu] Falha ao renderizar ${filePath}:`, error.stack || error.message);
    return { html: makeErrorPage('Erro ao renderizar a página', error.message), stats };
  }
}

function sendJSON(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function sendStaticFile(req, res, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); }
  catch { res.writeHead(400); res.end('Bad Request'); return true; }
  const relative = decoded.replace(/^\/+/, '');
  if (!relative || relative.includes('\0') || relative.split(/[\\/]+/).some(part => part.startsWith('.'))) return false;
  let full;
  try { full = resolveProjectFile(path.join('public', relative)); }
  catch { res.writeHead(403); res.end('Forbidden'); return true; }
  if (!isInsideProject(full) || !full.startsWith(path.resolve(PROJECT_ROOT, 'public') + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return true;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const extension = path.extname(full).toLowerCase();
  // Arquivos de código Cajyu não são assets públicos: nunca devem ser enviados ao navegador como texto.
  if (!MIME_TYPES[extension]) return false;
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension],
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache'
  });
  if (extension === '.html' || extension === '.htm') {
    const original = fs.readFileSync(full, 'utf8');
    res.end(appendDevelopmentRuntime(original, []));
  } else {
    fs.createReadStream(full).pipe(res);
  }
  return true;
}

function sendLiveReloadEvent(update = { reload: true }) {
  const payload = JSON.stringify(update).replace(/</g, '\\u003c');
  for (const client of liveReloadClients) {
    try { client.write(`event: reload\ndata: ${payload}\n\n`); }
    catch { liveReloadClients.delete(client); }
  }
}

function makeFileSnapshot() {
  const extensions = new Set(['.cjy', '.js', '.mjs', '.html', '.css', '.json', '.svg']);
  const ignored = new Set(['.git', 'node_modules', '.reacjyu', 'dist', 'build']);
  const records = new Map();
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = fs.statSync(full);
          records.set(path.relative(PROJECT_ROOT, full), `${stat.size}:${stat.mtimeMs}`);
        } catch {}
      }
    }
  };
  walk(PROJECT_ROOT);
  return records;
}

function startFileWatcher() {
  if (watcherTimer) clearInterval(watcherTimer);
  lastFileSnapshot = makeFileSnapshot();
  watcherTimer = setInterval(() => {
    const snapshot = makeFileSnapshot();
    const allFiles = new Set([...lastFileSnapshot.keys(), ...snapshot.keys()]);
    const changedFiles = [...allFiles].filter(file => lastFileSnapshot.get(file) !== snapshot.get(file));
    if (changedFiles.length) {
      lastFileSnapshot = snapshot;
      const cssOnly = changedFiles.every(file => file.startsWith(`public${path.sep}`) && path.extname(file).toLowerCase() === '.css');
      sendLiveReloadEvent({ cssOnly, files: changedFiles.map(file => file.split(path.sep).join('/')), reload: !cssOnly });
      console.log(cssOnly
        ? '[Reacjyu] CSS alterado — tentando atualizar os estilos sem recarregar a página.'
        : '[Reacjyu] Código alterado — navegador atualizado automaticamente.');
    }
  }, 400);
  watcherTimer.unref?.();
}

function normalizeRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('..') || route.includes('?') || route.includes('#')) {
    throw new Error('A rota deve começar com / e não pode conter .., ? ou #.');
  }
  return route;
}

function startConsole() {
  if (!process.stdin.isTTY || process.env.REACJYU_NO_CONSOLE === '1') return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'reacjyu> ' });
  rl.prompt();
  rl.on('line', line => {
    const trimmed = line.trim();
    try {
      if (!trimmed) { rl.prompt(); return; }
      if (trimmed.startsWith('.set ')) {
        const match = trimmed.slice(5).match(/^(\S+)\s+([\s\S]*)$/);
        if (!match) console.log('Uso: .set <variável> <valor>');
        else {
          const [, name, raw] = match;
          const value = raw.trim();
          const num = Number(value);
          backendState[name] = value !== '' && Number.isFinite(num) ? num : value;
          console.log(`Variável ${name} = ${String(backendState[name])}`);
        }
      } else if (trimmed.startsWith('.refresh')) {
        const arg = trimmed.split(/\s+/)[1] || 'frontend';
        if (arg === 'backend' || arg === '*') {
          backendState = Object.create(null);
          console.log('Estado do backend resetado.');
        }
        if (arg === 'frontend' || arg === '*') {
          sendLiveReloadEvent();
          console.log('Navegadores conectados serão atualizados.');
        }
      } else if (trimmed.startsWith('.addOnSource ')) {
        const parts = trimmed.slice('.addOnSource '.length).trim().split(/\s+/);
        if (parts.length < 2) console.log('Uso: .addOnSource <arquivo.cjy> <rota>');
        else {
          const file = parts[0];
          const route = normalizeRoute(parts[1]);
          resolveProjectFile(file);
          routes.set(route, file);
          console.log(`Rota ${route} → ${file}`);
        }
      } else if (trimmed === '.help') {
        console.log('.set <variável> <valor>\n.refresh [frontend|backend|*]\n.addOnSource <arquivo.cjy> <rota>\n.help');
      } else console.log('Comando desconhecido. Digite .help.');
    } catch (error) { console.error(error.message); }
    rl.prompt();
  });
  return rl;
}

export function createServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError(`Porta inválida: ${port}. Use um número entre 0 e 65535.`);
  const indexFile = options.indexFile || currentIndexFile;
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { res.writeHead(400); res.end('Bad Request'); return; }

    if (pathname === '/__reacjyu/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(': Reacjyu live reload connected\n\n');
      liveReloadClients.add(res);
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 20000);
      req.on('close', () => { clearInterval(heartbeat); liveReloadClients.delete(res); });
      return;
    }

    if (pathname === '/__reacjyu/state' && req.method === 'GET') return sendJSON(res, 200, backendState);
    if (pathname === '/__reacjyu/state' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const update = JSON.parse(body || '{}');
          if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('O corpo precisa ser um objeto JSON.');
          Object.assign(backendState, update);
          sendJSON(res, 200, { ok: true, state: backendState });
        } catch (error) { sendJSON(res, 400, { ok: false, error: error.message }); }
      });
      return;
    }

    if ((pathname === '/' || pathname === '/index.html') && req.method === 'GET') {
      const stats = { ...backendState };
      const { html, stats: newStats } = renderFile(indexFile, stats);
      backendState = Object.assign(backendState, newStats);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(html);
      return;
    }

    if (pathname === '/click' && req.method === 'POST') {
      backendState.contador = (Number(backendState.contador) || 0) + 1;
      return sendJSON(res, 200, { contador: backendState.contador });
    }

    if (routes.has(pathname) && req.method === 'GET') {
      const stats = { ...backendState };
      const { html } = renderFile(routes.get(pathname), stats);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && pathname !== '/') {
      if (sendStaticFile(req, res, pathname)) return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('404 — rota não encontrada');
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.listen(port, options.host || '127.0.0.1');
  server.on('listening', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`\nReacjyu 0.2.0 — http://localhost:${actualPort}`);
    console.log(`Projeto: ${PROJECT_ROOT}`);
    console.log('Live reload ativo: salve um .cjy, .js, .html, .css ou .json para atualizar o navegador.');
    console.log('Digite .help para ver os comandos do console.\n');
  });
  startFileWatcher();
  return server;
}

export function start(options = {}) {
  const pkgPath = path.resolve(PROJECT_ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.reacjyu?.index) currentIndexFile = pkg.reacjyu.index;
    } catch (error) {
      console.warn('[Reacjyu] Não foi possível ler package.json:', error.message);
    }
  }
  serverInstance = createServer({ ...options, indexFile: options.indexFile || currentIndexFile });
  if (options.console !== false) startConsole();
  return serverInstance;
}

export function stop() {
  if (watcherTimer) clearInterval(watcherTimer);
  watcherTimer = null;
  for (const client of liveReloadClients) client.end();
  liveReloadClients.clear();
  if (serverInstance) serverInstance.close();
  serverInstance = null;
}

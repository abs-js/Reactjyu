import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Button, renderFile, escapeHTML, createServer, stop } from '../src/index.js';
import * as library from '../CajyuLibs/reacjyu/main.js';

test('escapeHTML neutraliza caracteres HTML', () => {
  assert.equal(escapeHTML('<b title="x">&\'y\'</b>'), '&lt;b title=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/b&gt;');
});

test('componentes escapam texto/atributos e não permitem atributos onclick', () => {
  const button = new Button({ title: '"<texto>', onclick: function () {} });
  button.append('<script>alert(1)</script>');
  const html = button.toHTML({ handlers: [] });
  assert.match(html, /title="&quot;&lt;texto&gt;"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /onclick=/i);
  assert.match(html, /data-rj-click=/);
});

test('renderizador carrega exemplo, componente e live reload', () => {
  const { html } = renderFile('public/app.cjy', { contador: 5 });
  assert.match(html, /Olá, Reacjyu/);
  assert.match(html, /data-rj-click=/);
  assert.match(html, /EventSource\('\/__reacjyu\/events'\)/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'browser runtime should be included');
  assert.doesNotThrow(() => new Function(script), 'generated browser runtime must be valid JavaScript');
});

test('caminho de arquivo ausente resulta em erro seguro', () => {
  const { html } = renderFile('public/nao-existe.cjy');
  assert.match(html, /Arquivo não encontrado/);
  assert.doesNotMatch(html, /<script>/i);
});

test('biblioteca exporta CajyuLib e componentes', () => {
  assert.equal(typeof library.CajyuLib.Button, 'function');
  assert.equal(typeof library.Button, 'function');
  assert.equal(typeof library.Heading, 'function');
});

test('servidor responde e habilita live reload em HTML estático sem publicar .cjy', async () => {
  const cssPath = path.resolve('public/smoke-test.css');
  const htmlPath = path.resolve('public/smoke-test.html');
  fs.writeFileSync(cssPath, 'body { color: purple; }');
  fs.writeFileSync(htmlPath, '<!doctype html><html><body><p>static smoke</p></body></html>');
  const server = createServer({ port: 0, host: '127.0.0.1', indexFile: 'public/app.cjy' });
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Olá, Reacjyu/);
    const css = await fetch(`${base}/smoke-test.css`);
    assert.equal(css.status, 200);
    assert.match(await css.text(), /color: purple/);
    const staticHtml = await fetch(`${base}/smoke-test.html`);
    assert.equal(staticHtml.status, 200);
    assert.match(await staticHtml.text(), /__reacjyu\/events/);
    const source = await fetch(`${base}/app.cjy`);
    assert.equal(source.status, 404);
    const state = await fetch(`${base}/__reacjyu/state`);
    assert.equal(state.status, 200);

    const stream = await fetch(`${base}/__reacjyu/events`);
    const reader = stream.body.getReader();
    await reader.read(); // comentário de conexão
    const liveCssPath = path.resolve('public/live-reload-test.css');
    fs.writeFileSync(liveCssPath, 'body { color: orange; }');
    const eventText = await Promise.race([
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return '';
          const chunk = new TextDecoder().decode(value);
          if (chunk.includes('event: reload')) return chunk;
        }
      })(),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 2500))
    ]);
    assert.notEqual(eventText, 'timeout', 'saving CSS should emit a live-reload event');
    assert.match(eventText, /"cssOnly":true/);
    await reader.cancel();
    fs.rmSync(liveCssPath, { force: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
    stop();
    fs.rmSync(cssPath, { force: true });
    fs.rmSync(htmlPath, { force: true });
    fs.rmSync(path.resolve('public/live-reload-test.css'), { force: true });
  }
});

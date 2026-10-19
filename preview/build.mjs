import fs from 'fs';
import { USERS, LISTS, DEFAULT_STORES, SEED } from '../src/config.js';
const root = new URL('..', import.meta.url).pathname;
const css = fs.readFileSync(root + 'public/styles.css', 'utf8');
const js = fs.readFileSync(root + 'public/app.js', 'utf8');
const mock = fs.readFileSync(root + 'preview/mock.js', 'utf8');
const cfg = JSON.stringify({ users: USERS, lists: LISTS, stores: DEFAULT_STORES, seed: SEED });
const bar = `<div class="preview-bar"><span>Preview with sample data. Nothing saves.</span><span class="pv-btns"><button id="pv-doug">Doug</button><button id="pv-roman">Roman</button></span></div>`;
const barJs = `
function pv(id){ window.__mock.as(id); document.getElementById('pv-doug').className=id==='doug'?'on':''; document.getElementById('pv-roman').className=id==='roman'?'on':''; window.TodoApp.start(); }
document.getElementById('pv-doug').onclick=function(){pv('doug')}; document.getElementById('pv-roman').onclick=function(){pv('roman')};
document.getElementById('pv-doug').className='on';`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>To Do Preview</title>
<style>${css}</style></head><body>${bar}<div id="app"></div>
<script>window.__CFG=${cfg};window.__MOCKME=true;</script><script>${mock}\nwindow.__mock.as('doug');</script><script>${js}</script><script>${barJs}</script></body></html>`;
fs.mkdirSync(root + 'dist', { recursive: true });
fs.writeFileSync(root + 'dist/preview.html', html);
console.log('built', html.length);
const art = `<title>To Do Preview</title><style>${css}</style>${bar}<div id="app"></div>
<script>window.__CFG=${cfg};</script><script>${mock}\nwindow.__mock.as('doug');</script><script>${js}</script><script>${barJs}</script>`;
fs.writeFileSync(root + 'dist/artifact.html', art);

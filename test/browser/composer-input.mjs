// Requires Playwright and its Firefox browser. PLAYWRIGHT_MODULE can point to
// an external installation's index.mjs so it need not be added to the plugin.
const { firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await firefox.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:650,height:900}});
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto(new URL('../harness.html?scenario=empty&width=500', import.meta.url).href);
 await page.evaluate(() => {
  window.input=document.querySelector('textarea.abstractin-input');
  const root=input.closest('.abstractin-root'); root.dataset.readingIntro='false'; root.dataset.readingReady='true'; root.querySelector('.abstractin-composer').hidden=false;
  // Exercise the same attribute-based transition as the host, not an editor flag.
  input.setAttribute('disabled',''); input.removeAttribute('disabled');
  input.placeholder='Ask Codex something'; input.value='';
  window.sent=[];
  input.addEventListener('keydown', e => {if(AbstractIn.isSendKey(e)){e.preventDefault();sent.push(input.value);}});
 });
 const editor=page.locator('textarea.abstractin-input');
 await editor.click();
 assert.equal(await page.evaluate(()=>document.activeElement===input),true);
 assert.equal(await editor.isVisible(),true);
 assert.equal(await page.evaluate(()=>getComputedStyle(input,'::placeholder').color),'rgba(0, 0, 0, 0)');
 await page.keyboard.type('hello world'); assert.equal(await editor.inputValue(),'hello world');
 await page.keyboard.press('Backspace'); assert.equal(await editor.inputValue(),'hello worl');
 await page.evaluate(()=>input.setSelectionRange(0,0));
 await page.keyboard.press('Delete'); assert.equal(await editor.inputValue(),'ello worl');
 await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); assert.equal(await editor.inputValue(),'');
 await page.keyboard.type('Before $$x^2$$ after');
 assert.equal(await page.locator('.abstractin-math-preview math').count(),1);
 await page.locator('.abstractin-composer-formula').click();
 assert.equal(await page.evaluate(()=>document.activeElement===input && input.selectionStart===14),true);
 await page.keyboard.press('Backspace'); assert.equal(await editor.inputValue(),'Before $$x^2$ after');
 await page.keyboard.press('Control+z'); assert.equal(await editor.inputValue(),'Before $$x^2$$ after');
 await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); assert.equal(await editor.inputValue(),'');
 await page.keyboard.type('$$a=b'); await page.keyboard.press('Enter');
 assert.equal(await editor.inputValue(),'$$a=b\n'); assert.equal(await page.evaluate(()=>sent.length),0);
 await page.keyboard.type('c=d$$ done'); assert.equal(await page.locator('.abstractin-math-preview math').count(),1);
 await page.keyboard.press('Enter'); assert.equal(await page.evaluate(()=>sent.length),1);
 // Native replacement of a backward selection across a formula.
 await page.evaluate(()=>{input.value='Compare $x$ and $$y$$ now.';input.setSelectionRange(0,input.value.length,'backward');});
 await page.keyboard.type('replacement'); assert.equal(await editor.inputValue(),'replacement');
 await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
 await page.keyboard.insertText('中文输入'); assert.equal(await editor.inputValue(),'中文输入');
 await page.keyboard.press('Backspace'); assert.equal(await editor.inputValue(),'中文输');
 await page.evaluate(()=>{input.value='$x$';AbstractIn.autoGrow(input);AbstractIn.texToMathML=()=>{throw Error('test renderer failure');};});
 await page.keyboard.press('End'); await page.keyboard.type(' still typing');
 assert.equal(await editor.inputValue(),'$x$ still typing');
 assert.equal(await page.locator('.abstractin-math-preview').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('Firefox native composer passed: typing, focus placeholder, deletion, select-all, selection replacement, undo, formula click/source editing, multiline Enter/send, Chinese text, renderer failure.');
} finally {await browser.close();}

// Requires Playwright Firefox; PLAYWRIGHT_MODULE may point to an external index.mjs.
const { firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser=await firefox.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:650,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('../harness.html?scenario=empty&width=500', import.meta.url).href);
 await page.evaluate(()=>{
  window.input=document.querySelector('textarea.abstractin-input');
  const root=input.closest('.abstractin-root');root.dataset.readingIntro='false';root.dataset.readingReady='true';root.querySelector('.abstractin-composer').hidden=false;
  input.disabled=false;input.placeholder='Ask Codex something';input.value='';AbstractIn.autoGrow(input);
  window.sent=[];
  input.addEventListener('keydown',e=>{if(AbstractIn.isSendKey(e)){e.preventDefault();sent.push(input.value);}});
 });
 await page.waitForFunction(()=>input._composerEditor, {timeout:15000});
 const edit=page.frameLocator('.abstractin-composer-frame').locator('.cm-content');
 await edit.click();await page.keyboard.type('hello world');
 assert.equal(await page.evaluate(()=>input.value),'hello world');
 await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'hello worl');
 await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'');
 await page.keyboard.type('Before $$x^2$$ after');
 await page.evaluate(()=>input._composerEditor.view.contentDOM.blur());
 assert.equal(await page.frameLocator('.abstractin-composer-frame').locator('math').count(),1);
 await page.frameLocator('.abstractin-composer-frame').locator('.composer-math').click();
 assert.equal(await page.evaluate(()=>input.selectionStart),14);
 await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'Before $$x^2$ after');
 await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>input.value),'Before $$x^2$$ after');
 await page.keyboard.press('Control+a');await page.keyboard.press('Delete');assert.equal(await page.evaluate(()=>input.value),'');
 await page.keyboard.type('$$a=b');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>input.value),'$$a=b\n');assert.equal(await page.evaluate(()=>sent.length),0);
 await page.keyboard.type('c=d$$ done');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>sent.length),1);
 // Native mouse drag across a rendered formula, then delete the selection.
 await page.evaluate(()=>{input.value='Compare $x^2$ and $y^2$ now.';AbstractIn.autoGrow(input);input.focus();input.setSelectionRange(0,0);});
 const line=page.frameLocator('.abstractin-composer-frame').locator('.cm-line');
 const rect=await line.boundingBox();
 await page.mouse.move(rect.x+1,rect.y+rect.height/2);await page.mouse.down();
 await page.mouse.move(rect.x+rect.width-2,rect.y+rect.height/2,{steps:25});await page.mouse.up();
 await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'');
 // Recalled drafts, backwards selection replacement, clipboard and Unicode.
 await page.evaluate(()=>{input.value='Compare $x$ and $$y$$ now.';AbstractIn.autoGrow(input);input.focus();input.setSelectionRange(0,input.value.length,'backward');});
 await page.keyboard.type('replacement');assert.equal(await page.evaluate(()=>input.value),'replacement');
 await page.keyboard.press('Control+a');await page.keyboard.press('Delete');
 await page.keyboard.insertText('中文输入');assert.equal(await page.evaluate(()=>input.value),'中文输入');
 await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'中文输');
 await page.evaluate(()=>{input.value='';AbstractIn.autoGrow(input);input.focus();});
 await page.keyboard.insertText('a👨‍👩‍👧‍👦e\u0301');await page.keyboard.press('Backspace');
 assert.equal(await page.evaluate(()=>input.value),'a👨‍👩‍👧‍👦e');
 await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'a👨‍👩‍👧‍👦');
 await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>input.value),'a');
 // Ordinary paste is handled by CodeMirror, while images reach the existing handler.
 await page.evaluate(()=>{
  input.value='Ask ';AbstractIn.autoGrow(input);input.focus();input.setSelectionRange(4,4);
  const view=input._composerEditor.view, fw=view.dom.ownerDocument.defaultView;
  const event=new fw.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{files:[],getData:type=>type==='text/plain'?'$x^2$?':'<img src="bad"/>'}});
  view.contentDOM.dispatchEvent(event);
 });
 assert.equal(await page.evaluate(()=>input.value),'Ask $x^2$?');
 await page.evaluate(()=>{
  window.imagePastes=0;input.addEventListener('paste',e=>{imagePastes++;e.preventDefault();});
  const view=input._composerEditor.view, fw=view.dom.ownerDocument.defaultView;
  const event=new fw.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{files:[new fw.File(['image'],'image.png',{type:'image/png'})],getData:()=>''}});
  view.contentDOM.dispatchEvent(event);
 });
 assert.equal(await page.evaluate(()=>imagePastes),1);assert.equal(await page.evaluate(()=>input.value),'Ask $x^2$?');
 assert.deepEqual(errors,[]);
 console.log('CodeMirror typing, selection, deletion, formulas, undo and multiline Enter/send passed in Firefox');
}finally{await browser.close();}

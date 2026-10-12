// Runs against a real Zotero chrome window in an isolated test profile.
// nsITextInputProcessor generates Gecko composition events, rather than
// assigning editor text and assuming IME works.
async function testComposer(win, CS) {
 const doc = win.document;
  const holder=CS.el(doc,'div','abstractin-root');holder.style.cssText='width:600px;min-height:100px;';
  const input=CS.el(doc,'textarea','abstractin-input');input.disabled=true;input.placeholder='Ask Codex something';holder.append(input);(doc.body||doc.documentElement).append(holder);
  const dispose=CS.installMathComposer(input);
  const editor=await waitFor(()=>input._composerEditor);
  check('CodeMirror loaded in Zotero chrome host',!!editor);
  input.removeAttribute('disabled');await Zotero.Promise.delay(100);input.focus();
  const frame=holder.querySelector('iframe'), frameWin=frame.contentWindow;
  check('HTML editing document',frame.contentDocument.contentType==='text/html',frame.contentDocument.contentType);
  check('textarea hidden only after editor ready',input.hidden&&!frame.hidden);
  check('enabled after attribute transition',editor.view.contentDOM.contentEditable==='true');
  let notifications=0,sent=0;
  input.addEventListener('input',()=>notifications++);
  input.addEventListener('keydown',e=>{if(CS.isSendKey(e)){sent++;e.preventDefault();}});
  const tip=Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);
  check('native input transaction',tip.beginInputTransactionForTests(frameWin));
  tip.commitCompositionWith('Hello 中文');await Zotero.Promise.delay(100);
  check('native composition input syncs draft',input.value==='Hello 中文',input.value);
  function key(key,code,keyCode,mods={}) {editor.view.contentDOM.dispatchEvent(new frameWin.KeyboardEvent('keydown',{key,code,keyCode,bubbles:true,cancelable:true,...mods}));}
  key('Backspace','Backspace',8);await Zotero.Promise.delay(100);
  check('Backspace deletes one character',input.value==='Hello 中',input.value);
  input.setSelectionRange(0,input.value.length);key('Delete','Delete',46);await Zotero.Promise.delay(100);
  check('selected sentence deletes in one key',input.value==='');
  key('z','KeyZ',90,{ctrlKey:true});await Zotero.Promise.delay(100);
  check('undo restores selection deletion',input.value==='Hello 中',input.value);
  input.value='Before $$x^2$$ after';CS.autoGrow(input);input.focus();input.setSelectionRange(14,14);await Zotero.Promise.delay(100);
  check('caret after closing $$ reveals source',frame.contentDocument.querySelector('.composer-math-source')?.textContent==='$$x^2$$');
  input.setSelectionRange(input.value.length,input.value.length);await Zotero.Promise.delay(100);
  check('moving away renders math',!!frame.contentDocument.querySelector('math'));
  input.setSelectionRange(0,input.value.length,'backward');key('Backspace','Backspace',8);await Zotero.Promise.delay(100);
  check('whole sentence across formula deletes',input.value==='');
  input.value='$$a=b';CS.autoGrow(input);input.focus();input.setSelectionRange(input.value.length,input.value.length);key('Enter','Enter',13);await Zotero.Promise.delay(100);
  check('formula Enter adds newline without sending',input.value==='$$a=b\n'&&sent===0,{text:input.value,sent});
  input.value='Ready $x$';CS.autoGrow(input);input.focus();input.setSelectionRange(input.value.length,input.value.length);key('Enter','Enter',13);
  check('outside formula Enter reaches send',sent===1,sent);
  check('input listeners notified',notifications>3,notifications);
  input.disabled=true;await Zotero.Promise.delay(100);check('readonly follows host disabled state',editor.view.contentDOM.contentEditable==='false');
  dispose();check('dispose restores native input',!input.hidden&&!holder.querySelector('iframe'));holder.remove();

}

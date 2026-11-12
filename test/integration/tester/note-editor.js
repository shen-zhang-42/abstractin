// Run inside a real Zotero chrome window with an isolated profile/library.
async function testNoteEditor(win, plugin) {
 const doc=win.document, host=plugin.el(doc,'div');host.style.cssText='width:900px;height:600px;';
 const input=plugin.el(doc,'textarea');input.value='# Heading\n\n**bold** and $x^2$.\n\n| A | B |\n| --- | --- |\n| x | y |';host.append(input);doc.documentElement.append(host);
 const dispose=plugin.installMathComposer(input,{note:true});
 try {
  const api=await waitFor(()=>input._composerEditor),frame=host.querySelector('iframe'),content=frame.contentDocument;
  check('Live Markdown initializes in Zotero without source fallback',input.hidden&&!!api);
  check('Live Markdown has a content principal',!content.nodePrincipal.isSystemPrincipal);
  check('format toolbar buttons survive Gecko HTML parsing',content.querySelectorAll('.note-format-toolbar button').length>0);
  check('native Markdown table renders',content.querySelectorAll('table').length===1);
  await waitFor(()=>content.querySelector('.katex'));
  check('native inline formula renders',!!content.querySelector('.katex'));
  const offset=input.value.indexOf('bold'); api.select(offset,offset+4);
  const snapshot=api.getSelectionSnapshot();check('selection crosses the content bridge',snapshot.markdown==='bold',snapshot.markdown);
  check('AI edit snapshot crosses back into Live Markdown',api.replaceMarkdownRange('fixed',snapshot.from,snapshot.to,snapshot.sourceSelection)&&input.value.includes('**fixed**'),input.value);
  api.sync('| X | Y |\n| --- | --- |\n| 1 | 2 |',false,'');
  check('external Markdown update renders through the bridge',content.querySelectorAll('table').length===1);
 } finally {dispose();host.remove();}
}

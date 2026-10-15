// Native chrome DOM and real subprocess checks without provider credentials.
async function testAgentSetup(win, plugin) {
 const doc = win.document;
 const holder = plugin.el(doc, 'div', 'abstractin-root');
 holder.style.cssText = 'position:fixed;inset:20px;width:480px;height:620px;z-index:9999';
 (doc.body || doc.documentElement).append(holder);
 const command = PathUtils.join(plugin.getDataDir(), 'setup-fixture-cli');
 await Zotero.File.createDirectoryIfMissingAsync(plugin.getDataDir());
 await IOUtils.writeUTF8(command, String.raw`#!/bin/sh
if [ "$1" = "--version" ]; then echo "fixture-cli 1.0"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn":true}'; exit 0; fi
for arg in "$@"; do
 if [ "$arg" = "--input-format" ]; then
  exec python3 -c 'import sys,json; request=json.loads(sys.stdin.readline()); open(sys.argv[1]+".catalog","w").write(json.dumps(request)); print(json.dumps({"type":"control_response","response":{"subtype":"success","request_id":request["request_id"],"response":{"models":[{"value":"default","displayName":"Default from fixture"},{"value":"sonnet","displayName":"Sonnet from fixture"}]}}}),flush=True); sys.stdin.read()' "$0"
 fi
done
for arg in "$@"; do
 if [ "$arg" = "fixture-startup-error" ]; then echo 'Fixture CLI initialization failed before reading input' >&2; exit 1; fi
done
if [ "$1" = "-p" ]; then
 printf '%s\n' "$@" > "$0.args"
 cat > "$0.prompt"
 echo '{"type":"assistant","message":{"content":[{"type":"text","text":"fixture answer"}]}}'
 exit 0
fi
exit 1
`);
 await IOUtils.setPermissions(command, 0o755);
 plugin.setPref('claudePath', command); plugin.setPref('readingAgent', 'codex');
 const originalTest = plugin.testAndAdaptAgent;
 plugin.testAndAdaptAgent = async (id, progress) => {
  progress('Synthetic compatibility result (no provider request)');
  const result = { configKey: plugin.agentConfigKey(id), discussion: true, source: false };
  plugin.setPref('agentValidation', JSON.stringify({ [id]: result })); return result;
 };
 const button = label => [...holder.querySelectorAll('button')].find(n => n.textContent === label);
 const click = async label => { const node = button(label); if (!node || node.disabled) throw new Error('Cannot click ' + label); node.click(); await Zotero.Promise.delay(100); };
 try {

  const rendered = plugin.el(doc, 'div');
  plugin.renderMarkdown(doc, rendered, '- *The weather **adversely** affected the harvest.*\n\n**About *as*:** *as* means because.\n\n\\begin{equation}x=1\\end{equation} **After equation**');
  check('native Markdown renders italic text containing bold words', !!rendered.querySelector('li em strong') && rendered.querySelector('li em').textContent === 'The weather adversely affected the harvest.');
  check('native Markdown renders About as nested emphasis', [...rendered.querySelectorAll('strong em')].some(n => n.textContent === 'as'));
  const triple = plugin.el(doc, 'div');
  plugin.renderMarkdown(doc, triple, '- ***Now** he may have to withdraw from this project.* This means things have changed.');
  check('native triple delimiter opener keeps bold first word inside italic sentence', triple.querySelector('li em strong')?.textContent === 'Now' && triple.querySelector('li em')?.textContent === 'Now he may have to withdraw from this project.' && !triple.textContent.includes('*'));
  check('native equation keeps trailing emphasis and MathML', !!rendered.querySelector('math') && [...rendered.querySelectorAll('strong')].some(n => n.textContent === 'After equation'));
  rendered.textContent = '';
  plugin.renderMarkdown(doc, rendered, '\\begin{align*}\nx=1\n\n## Later heading\n1. **Later point**');
  check('native malformed math does not swallow later headings and lists', !!rendered.querySelector('.abstractin-h') && rendered.querySelector('ol li strong')?.textContent === 'Later point');

  const indexDir = PathUtils.join(plugin.getDataDir(), 'index-save-fixture');
  await Zotero.File.createDirectoryIfMissingAsync(indexDir);
  const indexContext = { dir: indexDir };
  const baseIndex = { version: 2, active: null, chapters: [], chats: [], migrated: {} };
  await Promise.all([plugin.writeDiscussionIndex(indexContext, { ...baseIndex, marker: 1 }), plugin.writeDiscussionIndex(indexContext, { ...baseIndex, marker: 2 })]);
  check('native atomic index saves preserve call order', (await plugin.discussionIndex(indexContext)).marker === 2);
  check('native atomic index write queue is cleared', plugin._discussionIndexWrites.size === 0);

  const originalEnvironment = Subprocess.getEnvironment;
  try {
   Subprocess.getEnvironment = () => ({ ...originalEnvironment(), HOME: plugin.getDataDir(), USERPROFILE: plugin.getDataDir() });
   plugin.setPref('readingSkillsDir', '');
   const skills = await Promise.all(['book', 'paper', 'extraction'].map(type => plugin.findReadingSkill(type)));
   check('fresh install loads all bundled skills without local CLI skill directories', skills.every(skill => skill.content.trim() && skill.path.includes('skill-cache')));
   check('bundled skill snapshot works before compatibility testing', (await plugin.agentSkillSnapshot()).files.length > 3);
   check('bundled vocabulary skill loads through native resource channel', (await plugin.loadVocabularyTutorSkill()).includes('english-vocabulary-tutor'));
  } finally { Subprocess.getEnvironment = originalEnvironment; }

  await plugin.loadClaudeModels(true);
  check('model catalog read through a real SDK-protocol child process', !plugin._claudeModelsError && plugin.modelLabel('claude', 'sonnet') === 'Sonnet from fixture', plugin._claudeModelsError);
  const sent = JSON.parse(await IOUtils.readUTF8(command + '.catalog'));
  check('model refresh sends only initialize, never a user turn', sent.type === 'control_request' && sent.request.subtype === 'initialize');
  check('CLI default option appears only once', plugin.getModels('claude').filter(model => model.id === '').length === 1);
  plugin.openAgentSetup(holder, 'claude', { reading: true, model: 'sonnet' });
  await Zotero.Promise.delay(200);
  const overlay = holder.querySelector('.abstractin-agent-setup');
  check('setup dialog opens in native Zotero chrome', overlay?.getAttribute('role') === 'dialog');
  const rect = overlay.querySelector('.abstractin-agent-setup-panel').getBoundingClientRect();
  check('dialog fits a reading panel', rect.width > 250 && rect.width <= 480 && rect.height > 200 && rect.height <= 620, { width: rect.width, height: rect.height });
  check('next blocked before executable check', button('Continue').disabled);
  await click('Find CLI'); await waitFor(() => !button('Continue').disabled);
  check('real subprocess detects CLI version and executable', holder.textContent.includes('Found local CLI: ' + command));
  await click('Continue');
  check('terminal command uses resolved executable', holder.querySelector('pre').textContent.includes(command + "' auth login"));
  await click('Check sign-in'); await waitFor(() => !button('Continue').disabled);
  check('real auth status subprocess confirms login', holder.textContent.includes('sign-in confirmed'));
  await click('Continue'); check('compatibility step warns about provider requests', holder.textContent.includes('Your paper is not sent'));
  check('selection unchanged before final enable', plugin.readingAgent() === 'codex');
  await click('Run connection & reading test'); await waitFor(() => !button('Continue').disabled);
  check('source limitation visible', holder.textContent.includes('Context only'));
  await click('Continue'); await click('Enable Claude');
  check('final enable selects agent and model', plugin.readingAgent() === 'claude' && plugin.getModel('claude') === 'sonnet');
  check('source limitation selects context mode', plugin.getPref('readingEvidenceMode') === 'context');
  check('dialog removed after enable', !holder.querySelector('.abstractin-agent-setup'));
  const trigger = plugin.el(doc, 'button', null, 'trigger'); holder.append(trigger); trigger.focus();
  plugin.openAgentSetup(holder, 'codex'); await click('Close');
  check('close restores native keyboard focus', doc.activeElement === trigger);
  const originalAPIRequest = plugin.deepSeekRequest;
  try {
   await plugin.saveDeepSeekKey('abstractin-native-fixture-key');
   check('DeepSeek key stored in native login manager', plugin.deepSeekKey() === 'abstractin-native-fixture-key');
   check('DeepSeek key absent from config fingerprint', !plugin.agentConfigKey('deepseek').includes('abstractin-native-fixture-key'));
   let cancelled = '';
   try { await plugin.deepSeekRequest('/models', null, { onSpawn: proc => proc.kill() }); } catch (e) { cancelled = e.message; }
   check('DeepSeek native HTTP transport can cancel before sending', cancelled === 'DeepSeek request cancelled.', cancelled);
   plugin.deepSeekRequest = async () => JSON.stringify({ data: [{ id: 'deepseek-flash', name: 'Fixture Flash' }] });
   plugin.openAgentSetup(holder, 'deepseek', { reading: true });
   check('DeepSeek opens API guide without CLI setup', holder.textContent.includes('No local CLI is required'));
   await click('Continue');
   check('DeepSeek key field masks input', holder.querySelector('input').type === 'password');
   await click('Save key & refresh models'); await waitFor(() => !button('Continue').disabled);
   const picker = holder.querySelector('select'); picker.value = 'deepseek-flash'; picker.dispatchEvent(new win.Event('change', { bubbles: true }));
   check('DeepSeek model catalog available in native UI', picker.options[1].textContent === 'Fixture Flash');
   await click('Continue');
   check('DeepSeek test discloses API charges', holder.textContent.includes('may incur API charges'));
   await click('Run connection & reading test'); await waitFor(() => !button('Continue').disabled);
   await click('Continue'); await click('Enable DeepSeek');
   check('DeepSeek enables only supplied-text reading', plugin.readingAgent() === 'deepseek' && plugin.getPref('readingEvidenceMode') === 'context');
   check('DeepSeek native capability probe needs no CLI', (await plugin.queryAgentCapabilities('deepseek', {})).files === false);
   plugin.removeDeepSeekKey();
   check('DeepSeek key removal uses native login manager', !plugin.deepSeekKey());
  } finally { plugin.deepSeekRequest = originalAPIRequest; plugin.removeDeepSeekKey(); holder._agentSetup?.close(); }
  const documentBody = plugin.el(doc, 'div'); (doc.body || doc.documentElement).append(documentBody);
  const originalFind = plugin.findBinary, originalBegin = plugin.beginReadingWorkflow;
  try {
   const linkedBook = new Zotero.Item('book'); linkedBook.setField('title', 'Externally maintained linked PDF'); await linkedBook.saveTx();
   const external = PathUtils.join(PathUtils.parent(Zotero.DataDirectory.dir), 'Dropbox 用户文档');
   await IOUtils.makeDirectory(external, { ignoreExisting: true });
   const linkedPath = PathUtils.join(external, 'Probability Models (第一章).pdf');
   await IOUtils.copy(PathUtils.join(repo, 'test', 'integration', 'assets', 'test-paper.pdf'), linkedPath);
   const oldBase = Zotero.Prefs.get('baseAttachmentPath') || '', oldRelative = !!Zotero.Prefs.get('saveRelativeAttachmentPath');
   let linkedReader;
   try {
    Zotero.Prefs.set('baseAttachmentPath', external); Zotero.Prefs.set('saveRelativeAttachmentPath', true);
    const linked = await Zotero.Attachments.linkFromFile({ file: linkedPath, parentItemID: linkedBook.id, contentType: 'application/pdf' });
    const originalPath = linked.attachmentPath, originalBytes = await IOUtils.read(linkedPath);
    const linkedCtx = { dir: PathUtils.join(plugin.getDataDir(), 'linked-source-fixture'), paperItem: linkedBook, attachmentItem: linked, reading: { type: 'book' } };
    check('native linked attachment uses a relative base directory outside Zotero data', originalPath.startsWith('attachments:') && await linked.getFilePathAsync() === linkedPath);
    const diskSource = await plugin.exportReadingSource(linkedCtx);
    check('native linked PDF exports searchable original text', diskSource.status === 'ready' && diskSource.accessMethod === 'file', diskSource);
    const copied = await IOUtils.read(PathUtils.join(linkedCtx.dir, 'source.pdf'));
    check('native linked PDF copy matches external original bytes', copied.length === originalBytes.length && copied.every((byte, index) => byte === originalBytes[index]));
    linkedReader = await Zotero.Reader.open(linked.id);
    linkedCtx.reader = linkedReader;
    await waitFor(() => plugin.readingPDFApplication(linkedCtx)?.pdfDocument?.getData, 15000);
    const originalAsync = linked.getFilePathAsync, originalSync = linked.getFilePath;
    try {
     linked.getFilePathAsync = async () => false; linked.getFilePath = () => false;
     const snapshot = await plugin.exportReadingSource(linkedCtx);
     check('native exact open reader rescues unavailable linked PDF paths', snapshot.status === 'ready' && snapshot.accessMethod === 'reader-snapshot' && snapshot.pageMapping, snapshot);
     const again = await plugin.exportReadingSource(linkedCtx);
     check('native reader snapshot cache is keyed to the original PDF bytes', again.status === 'ready' && again.signature === snapshot.signature);
    } finally { linked.getFilePathAsync = originalAsync; linked.getFilePath = originalSync; }
    const unchanged = await IOUtils.read(linkedPath);
    check('native linked source keeps external bytes and Zotero attachment link unchanged', linked.attachmentPath === originalPath && unchanged.length === originalBytes.length && unchanged.every((byte, index) => byte === originalBytes[index]));
   } finally { linkedReader?.close(); Zotero.Prefs.set('baseAttachmentPath', oldBase); Zotero.Prefs.set('saveRelativeAttachmentPath', oldRelative); }
   const item = new Zotero.Item('journalArticle'); item.setField('title', 'Reading refresh fixture'); await item.saveTx();
   const file = PathUtils.join(repo, 'test', 'integration', 'assets', 'test-paper.pdf');
   const first = await Zotero.Attachments.importFromFile({ file, parentItemID: item.id });
   const second = await Zotero.Attachments.importFromFile({ file, parentItemID: item.id });
   const best = await item.getBestAttachment(), selected = best.id === first.id ? second : first;
   plugin.setPref('readingAgent', 'codex');
   plugin.setPref('readingSkillsDir', '/deliberately-missing/obsolete-skills');
   check('obsolete local skill preference does not override bundled skills', (await plugin.findReadingSkill('paper')).path.includes('skill-cache'));
   plugin.renderSkeleton(doc, documentBody);
   const root = documentBody.querySelector('.abstractin-root');
   const view = { doc, root, ctx: await plugin.getContext(item), input: root.querySelector('.abstractin-input'), logEl: root.querySelector('.abstractin-log') };
   plugin._views.set(root, view); plugin.renderMessages(view, []);
   plugin.findBinary = async id => id === 'codex' ? command : originalFind.call(plugin, id);
   let began = 0; plugin.beginReadingWorkflow = async current => { began++; check('native reading workflow receives selected PDF', current.ctx.attachmentItem.id === selected.id && current.ctx.reading.type === 'paper'); };
   await plugin.openReadingSetup(root);
   const setup = view.readingSetup;
   plugin.renderSkeleton(doc, documentBody); await plugin.renderContent(doc, documentBody, item);
   check('native item refresh preserves the reading setup', documentBody.querySelector('.abstractin-root') === root && plugin._views.get(root) === view && view.readingSetup === setup);
   await plugin.answerReadingSetup(view, 'Reading refresh fixture'); await plugin.answerReadingSetup(view, 'paper');
   await plugin.answerReadingSetup(view, String(selected.id)); await plugin.answerReadingSetup(view, 'skip');
   check('native setup completes without returning to start', began === 1 && !view.readingSetup && !root.querySelector('.abstractin-start-reading'));
   plugin._readingStates.delete(first.id); plugin._readingStates.delete(second.id);
   const restored = await plugin.getContext(item);
   check('native parent restores selected nondefault PDF from disk', restored.attachmentItem.id === selected.id && restored.reading?.type === 'paper');
   await plugin.renderContent(doc, documentBody, item);
   check('native refresh after activation retains reading state', plugin._views.get(root)?.ctx.attachmentItem.id === selected.id && !root.querySelector('.abstractin-start-reading'));
   const exportView = plugin._views.get(root);
   check('reading export button is available in native Zotero', !!root.querySelector('.abstractin-export-reading') && !root.querySelector('.abstractin-export-reading').disabled);
   plugin.openReadingExport(root);
   check('native export dialog explains source supplementation and charges', root.querySelector('.abstractin-reading-export')?.textContent.includes('fill relevant gaps') && root.querySelector('.abstractin-reading-export')?.textContent.includes('allowance'));
   const nativeRun = plugin.runBackend;
   try {
    await plugin.saveHistory(exportView.ctx.dir, [{ role: 'user', text: 'Explain the main result' }, { role: 'assistant', text: 'Earlier reading discussion.' }]);
    const layout = plugin.el(doc, 'div', 'abstractin-history-browser'); root.append(layout);
    try {
     const chapter = plugin.el(doc, 'section', 'abstractin-history-chapter');
     const head = plugin.el(doc, 'button', 'abstractin-history-chapter-head');
     const label = plugin.el(doc, 'span', 'abstractin-history-chapter-label');
     label.append(plugin.svgIcon(doc, 'chevronRight', 'abstractin-history-chapter-chevron'), plugin.el(doc, 'h3', null, 'chap-01 · Chapter 1: Probability Models'));
     head.append(label); chapter.append(head); layout.append(chapter);
     for (const width of [220, 460]) {
      layout.style.width = width + 'px';
      const box = head.getBoundingClientRect(), content = label.getBoundingClientRect();
      check('chapter label stays vertically centered at width ' + width, Math.abs((box.top + box.bottom - content.top - content.bottom) / 2) < 1 && box.height >= content.height + 18, { box: box.toJSON(), content: content.toJSON() });
     }
     const turns = plugin.el(doc, 'div', 'abstractin-chat-turns'); layout.append(turns);
     await plugin.showManagedTurns({ ...exportView, historyBrowser: {} }, exportView.ctx.discussion, turns);
     const turn = turns.querySelector('.abstractin-chat-turn'), turnHead = turn.querySelector('.abstractin-chat-turn-heading');
     check('native turn label has an explicit space before the question', turnHead.textContent === 'Turn 1 Explain the main result');
     check('native turn answer appears below its question', win.getComputedStyle(turn).display === 'flex' && turn.lastElementChild.getBoundingClientRect().top >= turnHead.getBoundingClientRect().bottom + 4);
    } finally { layout.remove(); }
    plugin.runBackend = async (_, request) => {
     const input = JSON.parse(request.question.split('\nDATA:\n')[1].split('\nLOOKUP RESULTS:\n')[0]);
     return { text: JSON.stringify(input.records ? { points: [{ title: 'Main result', body: 'Combined reading discussion.', chapterID: null, originalNumber: '', quote: '', refs: input.records.map(r => r.id) }] } : { groups: [] }) };
    };
    const job = { backend: 'codex', model: '', effort: '', progress() {}, cancelled: false };
    const exported = await plugin.generateReadingExport(exportView.ctx, job);
    check('native installed XPI exports a numbered paper digest', exported.markdown.includes('### paper.S1 Main result'));
    check('native export source preparation reads the actual PDF', !!job.source.text, job.source.error);
    check('native export keeps current conversation untouched', (await plugin.loadHistory(exportView.ctx.dir)).length === 2);
   } finally { plugin.runBackend = nativeRun; }
   [...root.querySelector('.abstractin-reading-export').querySelectorAll('button')].find(b => b.textContent === 'Close').click();
   check('native export dialog closes without leaving a job lock', !plugin._readingExports.size);
  } finally { plugin.findBinary = originalFind; plugin.beginReadingWorkflow = originalBegin; documentBody.querySelector('.abstractin-root')?.disposeUI?.(); documentBody.remove(); }
  const snapshot = await plugin.agentSkillSnapshot();
  const skills = snapshot.files.filter(file => file.name === 'SKILL.md').map(file => file.content).join('\n');
  const request = { ctx: { dir: plugin.getDataDir() }, question: skills + '\nExplain 中文 🐒', history: [], session: null, model: '', effort: '', onProgress() {}, onSpawn() {} };
  check('original skill fixture exceeds Windows command-line limit', plugin.claudeArgs(request).join(' ').length > 32767);
  const answer = await plugin.runClaude(request);
  check('Claude long-prompt process runs and parses reply in native Zotero', answer.text === 'fixture answer', answer);
  const piped = await IOUtils.readUTF8(command + '.prompt');
  const argv = await IOUtils.readUTF8(command + '.args');
  check('all original skills and Unicode reach the child stdin intact', piped === plugin.claudePrompt(request), { received: piped.length, expected: plugin.claudePrompt(request).length });
  check('child command stays below Windows argument limit', argv.length < 10000 && !argv.includes(skills), argv.length);
  const failure = await plugin.runClaude({ ...request, question: 'long prompt 中文 '.repeat(100000), model: 'fixture-startup-error' });
  check('early CLI exit reports its real stderr instead of File closed', failure.error === 'Fixture CLI initialization failed before reading input', failure);
  const retry = await plugin.runClaude(request);
  check('normal requests still succeed after an input pipe failure', retry.text === 'fixture answer', retry);
 } finally { plugin.testAndAdaptAgent = originalTest; holder._agentSetup?.close(); holder.remove(); }
}

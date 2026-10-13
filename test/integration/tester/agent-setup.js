// Native chrome DOM and real subprocess checks without provider credentials.
async function testAgentSetup(win, plugin) {
 const doc = win.document;
 const holder = plugin.el(doc, 'div', 'abstractin-root');
 holder.style.cssText = 'position:fixed;inset:20px;width:480px;height:620px;z-index:9999';
 (doc.body || doc.documentElement).append(holder);
 const command = PathUtils.join(plugin.getDataDir(), 'setup-fixture-cli');
 await Zotero.File.createDirectoryIfMissingAsync(plugin.getDataDir());
 await IOUtils.writeUTF8(command, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fixture-cli 1.0"; exit 0; fi\nif [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo \'{"loggedIn":true}\'; exit 0; fi\nexit 1\n');
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
 } finally { plugin.testAndAdaptAgent = originalTest; holder._agentSetup?.close(); holder.remove(); }
}

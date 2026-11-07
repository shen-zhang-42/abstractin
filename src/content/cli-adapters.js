"use strict";
(() => {
 const findBinary = AbstractIn.findBinary;
 Object.assign(AbstractIn, {
  async findBinary(id, options = {}) {
   if (options.directory !== undefined) return this.findCLIInDirectory(id, options.directory, options);
   try { return await findBinary.call(this, id); }
   catch (error) {
    const agent = this.BACKENDS[id];
    if (!Zotero.isWin || !agent?.custom || this.getPref(agent.pathPref)) throw error;
    const env = this.buildChildEnvironment({ preserveAPIKeys: true });
    for (const folder of (env.PATH || "").split(";").filter(Boolean)) {
     const path = OS.Path.join(folder, agent.command + ".cmd");
     if (await OS.File.exists(path)) return path;
    }
    throw error;
   }
  },
  defaultCLISearchDirectory() {
   if (Zotero.isWin) return "C:\\";
   const env = Subprocess.getEnvironment?.() || {};
   return env.HOME || "/";
  },
  async findCLIInDirectory(id, directory, { onProgress = () => {}, isCancelled = () => false, timeout = 120000 } = {}) {
   const agent = this.BACKENDS[id];
   if (!agent || agent.api) throw new Error("Choose a local CLI agent.");
   directory = String(directory || this.defaultCLISearchDirectory()).trim();
   if (/[\r\n\0]/.test(directory) || !/^(?:[A-Za-z]:[\\/]|\/)/.test(directory)) throw new Error("Enter an absolute search directory.");
   const root = OS.Path.normalize(directory), rootInfo = await OS.File.stat(root);
   if (!rootInfo.isDir) throw new Error("The CLI search location must be a directory.");
   const comparable = value => Zotero.isWin ? value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() : value.replace(/\/$/, "");
   const inside = path => comparable(path) === comparable(root) || comparable(path).startsWith(comparable(root) + "/");
   const basename = agent.command.replace(/^.*[\\/]/, ""), name = Zotero.isWin ? basename.toLowerCase() : basename;
   const names = Zotero.isWin && !/\.(?:exe|cmd|bat|ps1)$/i.test(name) ? [name + ".exe", name, name + ".cmd", name + ".ps1", name + ".bat"] : [name];
   // Native Claude/Antigravity launchers require a real executable. Custom
   // adapters (including Gemini) can use the npm shim resolver below.
   const accepted = Zotero.isWin && ["claude", "agy"].includes(id) ? names.filter(value => value.endsWith(".exe")) : names;
   const env = Subprocess.getEnvironment?.() || {}, home = env.USERPROFILE || env.HOME || "";
   const preferred = home ? this.extraSearchPaths(home) : [];
   preferred.push(...(env.PATH || "").split(Zotero.isWin ? ";" : ":").filter(Boolean));
   if (Zotero.isWin) {
    if (home) preferred.push(OS.Path.join(home, "AppData", "Local", "Programs"), OS.Path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages"));
    preferred.push("C:\\Program Files", "C:\\Program Files (x86)");
   }
   const queue = [root], seen = new Set(), started = Date.now(); let scanned = 0, cursor = 0;
   const check = () => {
    if (isCancelled()) throw new Error("CLI search cancelled.");
    if (Date.now() - started > timeout) throw new Error("CLI search timed out before covering the directory. Choose a narrower search directory and try again.");
   };
   const result = async path => {
    if (Zotero.isWin && id === "codex") { try { return await this.windowsCodexExecutable(path); } catch (_) { return null; } }
    return path;
   };
   // Probe known installation folders first, but only within the user's root.
   for (const folder of [...new Set(preferred)].filter(inside)) {
    check();
    for (const filename of accepted) {
     const path = OS.Path.join(folder, filename);
     try { const info = await OS.File.stat(path); if (!info.isDir && !info.isSymLink) { const found = await result(path); check(); if (found) return found; } } catch (error) { if (isCancelled()) throw error; }
    }
    if (comparable(folder) !== comparable(root)) queue.push(folder);
   }
   while (cursor < queue.length) {
    check(); const folder = queue[cursor++], key = comparable(folder);
    if (seen.has(key)) continue; seen.add(key);
    if (scanned++ % 25 === 0) onProgress("Searching for " + basename + " in " + folder);
    const entries = []; let iterator;
    try {
     const info = await OS.File.stat(folder, { unixNoFollowingLinks: true });
     if (!info.isDir || info.isSymLink) continue;
     iterator = new OS.File.DirectoryIterator(folder); await iterator.forEach(entry => { if (entries.length % 256 === 0) check(); entries.push(entry); });
    } catch (error) { check(); if (key === comparable(root)) throw new Error("Cannot read the CLI search directory. Check its path and permissions."); continue; }
    finally { iterator?.close(); }
    check();
    for (const filename of accepted) {
     const entry = entries.find(value => !value.isDir && !value.isSymLink && (Zotero.isWin ? value.name.toLowerCase() : value.name) === filename);
     if (entry) { const found = await result(entry.path); check(); if (found) return found; }
    }
    for (const entry of entries) if (entry.isDir && !entry.isSymLink && !["$recycle.bin", "system volume information", ".git"].includes(entry.name.toLowerCase())) queue.push(entry.path);
    if (scanned % 25 === 0) await new Promise(resolve => Zotero.getMainWindow().setTimeout(resolve, 0));
   }
   throw new Error("Could not find " + basename + " in " + root + " or its readable subdirectories. Choose its installation directory and try again.");
  },
  async cliInvocation(id, args = []) {
   const path = await this.findBinary(id);
   if (!Zotero.isWin || !/\.(?:cmd|bat|ps1)$/i.test(path)) return { command: path, args: [...args] };
   // npm shims are shell scripts. Resolve their JS entry point and launch Node
   // directly so user arguments never pass through cmd.exe or PowerShell.
   const shim = await Zotero.File.getContentsAsync(path);
   const match = shim.match(/(?:%dp0%|%~dp0|\$basedir)[\\/]([^"\r\n]*?\.(?:m?js|cjs))/i);
   if (!match || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(match[1])) throw new Error("This shell wrapper is not a recognized npm CLI. Choose its native executable, or use node.exe as the executable and put the JS entry point first in Arguments.");
   const directory = path.replace(/[\\/][^\\/]+$/, ""), script = OS.Path.join(directory, ...match[1].split(/[\\/]/));
   if (!(await OS.File.exists(script))) throw new Error("The npm CLI entry point does not exist. Check the installation.");
   const localNode = OS.Path.join(directory, "node.exe");
   const node = await OS.File.exists(localNode) ? localNode : await Subprocess.pathSearch("node.exe", this.buildChildEnvironment({ preserveAPIKeys: true }));
   return { command: node, args: [script, ...args] };
  },
  async runTextCLIAgent(id, request) {
   if (request.images?.length) return { text: "", error: "Text CLI does not support image input. Use an ACP or JSONL adapter for images." };
   const prompt = this.systemPrompt(request.ctx) + "\n\n" + this.transcriptFor(request.history || [], null) + (request.question || "") + this.formattingReminder(this.getLanguage());
   const model = request.model || this.getModel(id) || "";
   const args = this.BACKENDS[id].args.map(value => value.replace(/\{model\}/g, () => model).replace(/\{prompt\}/g, () => prompt));
   const invocation = await this.cliInvocation(id, args);
   const result = await this.runAgentProcess(invocation.command, invocation.args, request.ctx.dir, null, request.onSpawn,
    this.BACKENDS[id].args.some(value => value.includes("{prompt}")) ? null : prompt + "\n", 180000, this.buildChildEnvironment({ preserveAPIKeys: true }));
   // Text CLIs have no portable streaming/session protocol. History is supplied
   // on each call; only a successful final stdout becomes an answer.
   return result.exitCode === 0 && result.stdout.trim() ? { text: result.stdout.trim(), sessionId: null } : { text: "", error: result.stderr.trim() || "CLI returned no answer." };
  },
 });
})();

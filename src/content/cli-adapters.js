"use strict";
(() => {
 const findBinary = AbstractIn.findBinary;
 Object.assign(AbstractIn, {
  async findBinary(id, options = {}) {
   if (options.directory !== undefined) return this.findCLIInDirectory(id, options.directory, options);
   try { return await findBinary.call(this, id); }
   catch (error) {
    const agent = this.BACKENDS[id];
    if (!agent || agent.api || this.getPref(agent.pathPref)) throw error;
    // Zotero may not inherit the terminal's PATH, so check installer folders directly.
    for (const folder of this.cliLauncherFolders()) {
     for (const filename of this.cliFileNames(id)) {
      const path = OS.Path.join(folder, filename);
      if (!(await OS.File.exists(path))) continue;
      if (!Zotero.isWin || id !== "codex") return path;
      try { return await this.windowsCodexExecutable(path); } catch (_) {}
     }
    }
    throw error;
   }
  },
  defaultCLISearchDirectory() {
   if (Zotero.isWin) return "C:\\";
   const env = Subprocess.getEnvironment?.() || {};
   return env.HOME || "/";
  },
  // File names a CLI may have. Native Claude/Antigravity launchers require a
  // real executable; other agents may use npm shims resolved by cliInvocation.
  cliFileNames(id) {
   const basename = this.BACKENDS[id].command.replace(/^.*[\\/]/, ""), name = Zotero.isWin ? basename.toLowerCase() : basename;
   const names = Zotero.isWin && !/\.(?:exe|cmd|bat|ps1)$/i.test(name) ? [name + ".exe", name, name + ".cmd", name + ".ps1", name + ".bat"] : [name];
   return Zotero.isWin && ["claude", "agy"].includes(id) ? names.filter(value => value.endsWith(".exe")) : names;
  },
  // Folders where installers and package managers put CLI launchers (checked without recursion).
  cliLauncherFolders(env = Subprocess.getEnvironment?.() || {}) {
   const home = env.USERPROFILE || env.HOME || "";
   const folders = home ? this.extraSearchPaths(home) : [];
   folders.push(...(env.PATH || "").split(Zotero.isWin ? ";" : ":").map(value => value.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean));
   if (Zotero.isWin && home) {
    const local = env.LOCALAPPDATA || OS.Path.join(home, "AppData", "Local"), roaming = env.APPDATA || OS.Path.join(home, "AppData", "Roaming");
    folders.push(OS.Path.join(roaming, "npm"), OS.Path.join(local, "Microsoft", "WinGet", "Links"), OS.Path.join(local, "pnpm"),
     OS.Path.join(local, "Volta", "bin"), OS.Path.join(home, "scoop", "shims"), OS.Path.join(home, ".bun", "bin"), "C:\\Program Files\\nodejs");
   }
   return [...new Set(folders)];
  },
  async findCLIInDirectory(id, directory, { onProgress = () => {}, isCancelled = () => false, timeout = 120000 } = {}) {
   const agent = this.BACKENDS[id];
   if (!agent || agent.api) throw new Error("Choose a local CLI agent.");
   directory = String(directory || this.defaultCLISearchDirectory()).trim().replace(/^"(.*)"$/, "$1");
   if (/[\r\n\0]/.test(directory) || !/^(?:[A-Za-z]:[\\/]|\/)/.test(directory)) throw new Error("Enter an absolute path to the CLI executable or a folder to search.");
   const root = OS.Path.normalize(directory);
   let rootInfo;
   try { rootInfo = await OS.File.stat(root); }
   catch (_) { throw new Error("Cannot read " + root + ". Check the path and its permissions."); }
   const accepted = this.cliFileNames(id), basename = agent.command.replace(/^.*[\\/]/, "");
   const nativeOnly = Zotero.isWin && ["claude", "agy"].includes(id);

   // ---- A chosen executable is used directly; only its file type is checked
   if (!rootInfo.isDir) {
    if (Zotero.isWin && !(nativeOnly ? /\.exe$/i : /\.(?:exe|cmd|bat|ps1)$/i).test(root)) {
     throw new Error(nativeOnly ? "Choose the native " + basename + ".exe, or a folder to search." : "Choose an executable (.exe, .cmd, .bat or .ps1), or a folder to search.");
    }
    return Zotero.isWin && id === "codex" ? await this.windowsCodexExecutable(root) : root;
   }

   // ---- A folder is searched: launcher folders, then likely install folders, then the whole folder
   const comparable = value => Zotero.isWin ? value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() : value.replace(/\/$/, "");
   const inside = path => comparable(path) === comparable(root) || comparable(path).startsWith(comparable(root) + "/");
   const env = Subprocess.getEnvironment?.() || {}, home = env.USERPROFILE || env.HOME || "";
   const local = env.LOCALAPPDATA || (home && OS.Path.join(home, "AppData", "Local")), roaming = env.APPDATA || (home && OS.Path.join(home, "AppData", "Roaming"));
   // Folders searched completely before the rest of the root, e.g. CLIs bundled in editor extensions.
   const likely = !home ? [] : Zotero.isWin ? [
    OS.Path.join(home, ".local"), OS.Path.join(roaming, "npm", "node_modules"), OS.Path.join(local, "Programs"),
    OS.Path.join(local, "Microsoft", "WinGet", "Packages"), OS.Path.join(home, ".vscode", "extensions"),
    OS.Path.join(home, ".cursor", "extensions"), OS.Path.join(home, ".windsurf", "extensions"),
    "C:\\Program Files", "C:\\Program Files (x86)", home,
   ] : [OS.Path.join(home, ".local"), OS.Path.join(home, ".vscode", "extensions"), OS.Path.join(home, ".cursor", "extensions"), home];
   // System and cache folders are large and never hold a CLI; skipping them keeps a drive-wide search feasible.
   const skipped = new Set(["$recycle.bin", "system volume information", ".git", ".cache", "winsxs", "$winreagent", "perflogs", "recovery"]);
   const skippedPaths = new Set((Zotero.isWin ? [root.slice(0, 3) + "Windows", local && OS.Path.join(local, "Packages"), local && OS.Path.join(local, "Temp")]
    : ["/proc", "/sys", "/dev"]).filter(Boolean).map(comparable));
   const seen = new Set(), started = Date.now(); let scanned = 0;
   const check = () => {
    if (isCancelled()) throw new Error("CLI search cancelled.");
    if (Date.now() - started > timeout) throw new Error("CLI search timed out before covering the directory. Choose the executable itself or a narrower folder and try again.");
   };
   const result = async path => {
    if (Zotero.isWin && id === "codex") { try { return await this.windowsCodexExecutable(path); } catch (_) { return null; } }
    return path;
   };
   for (const folder of this.cliLauncherFolders(env).filter(inside)) {
    check();
    for (const filename of accepted) {
     const path = OS.Path.join(folder, filename);
     try { const info = await OS.File.stat(path); if (!info.isDir && !info.isSymLink) { const found = await result(path); check(); if (found) return found; } } catch (error) { if (isCancelled()) throw error; }
    }
   }
   // Breadth-first: each likely folder is searched completely, then the root.
   const queue = [...new Set(likely.filter(inside))]; let cursor = 0, rootQueued = false;
   while (cursor < queue.length || !rootQueued) {
    if (cursor === queue.length) { queue.push(root); rootQueued = true; }
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
    for (const entry of entries) if (entry.isDir && !entry.isSymLink && !skipped.has(entry.name.toLowerCase()) && !skippedPaths.has(comparable(entry.path))) queue.push(entry.path);
    if (scanned % 25 === 0) await new Promise(resolve => Zotero.getMainWindow().setTimeout(resolve, 0));
   }
   throw new Error("Could not find " + basename + " in " + root + " or its readable subdirectories. Choose the executable itself, or its installation folder, and try again.");
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

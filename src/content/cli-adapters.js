"use strict";
(() => {
 const findBinary = AbstractIn.findBinary;
 Object.assign(AbstractIn, {
  async findBinary(id) {
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

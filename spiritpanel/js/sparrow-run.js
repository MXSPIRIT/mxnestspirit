/*
 * sparrow-run.js — runs the Sparrow binary from the CEP panel.
 *
 * Split from sparrow.js on purpose: that file is pure data translation and runs
 * under Node in the test suite, this one touches CEP and cannot. Everything
 * here is I/O and process control; no geometry.
 *
 * TWO THINGS COST A WHOLE EVENING HERE, both from assumptions never checked:
 *
 * 1. WORKING DIRECTORY. Sparrow always writes its result to <cwd>/output/ and
 *    has no flag to redirect it. The first version spawned the binary directly
 *    and looked for the file under the extension, assuming CEP would start the
 *    process there. It does not, and nothing was ever written -- anywhere on
 *    the disk. Every run failed with a bare "the solver produced nothing",
 *    which reads like a solver problem and is not one.
 *
 * 2. THE SOLVER'S OUTPUT. CEP's proc.stdout/proc.stderr callbacks did not
 *    deliver the solver's text, so the panel could not tell "your polygon was
 *    refused" from "it crashed" -- and the retry ladder, which was gated on
 *    that distinction, never ran once in production.
 *
 * Both are fixed the same way: go through a shell that cd's into a scratch
 * directory first and redirects both streams into a file we can read back.
 * Nothing is assumed about where the process starts or what CEP forwards.
 */
(function () {
  "use strict";

  var cs = new CSInterface();
  // Adobe's SystemPath enum does not exist in this project's minimal
  // CSInterface shim -- reading it threw a ReferenceError that silently killed
  // a whole module once already. Pass the plain string, as main.js does.
  var EXT = (cs.getSystemPath ? cs.getSystemPath("extension") : "").replace(/\\/g, "/");

  var IS_WIN = navigator.platform.toLowerCase().indexOf("win") >= 0;
  var BIN = EXT + "/bin/" + (IS_WIN ? "sparrow.exe" : "sparrow");

  /* Scratch lives OUTSIDE the extension: a .zxp is signed, and writing into an
   * installed bundle is both impolite and, on a machine-wide install, not
   * always permitted. */
  /*
   * On Windows, the user's OWN data folder -- never C:\Windows\Temp.
   *
   * C:\Windows\Temp belongs to the system. Whether an ordinary account may
   * write there depends on the machine, and security software watches it
   * closely, so the panel could fail to write its instance or the engine its
   * solution, on exactly the computers nobody can inspect. The diagnostic run
   * on a designer's PC proved the engine works from the user's own folders;
   * this puts the panel there too. userData always belongs to the user.
   */
  /*
   * FULL paths to cmd.exe, never the bare name.
   *
   * CEP's createProcess does not search PATH. Given "cmd.exe" it returns err 3,
   * which Adobe's own CEPEngine_extensions.js defines as ERR_NOT_FOUND. macOS
   * never showed it because "/bin/sh" was always absolute. A designer's PC ran
   * the engine perfectly from PowerShell -- which does search PATH -- and failed
   * every time from the panel, with exactly that code.
   * System32 first; SysWOW64 only matters for a 32-bit panel engine.
   */
  var WIN_CMD = ["C:\\Windows\\System32\\cmd.exe", "C:\\Windows\\SysWOW64\\cmd.exe"];

  var WIN_DATA = IS_WIN ? (cs.getSystemPath ? cs.getSystemPath("userData") : "").replace(/\\/g, "/") : "";
  /* The work path is handed to cmd.exe bare, so it must hold nothing cmd.exe
   * could split or reinterpret: no space (C:\Users\John Smith), no accent
   * (C:\Users\Aurélien), no & or %. Such an account works in the shared
   * Public folder instead, which every account may write to. */
  /* And on a drive letter: a Roaming folder redirected to a network share
   * (\\\\nas\\profiles\\...) cannot be cmd.exe's current directory, so "cd /d"
   * fails and the engine would start in the wrong folder (review of 3.8). */
  var WIN_BASE = (WIN_DATA && /^[A-Za-z]:\/[A-Za-z0-9\/._~\-]*$/.test(WIN_DATA)) ? WIN_DATA : "C:/Users/Public";
  var WORK = IS_WIN ? (WIN_BASE + "/mxnestspirit-sparrow") : "/tmp/mxnestspirit-sparrow";

  /*
   * The Windows launch form that last worked on this machine, SAVED.
   *
   * One job on several sheets runs the engine several times, the retry ladder
   * more again, and Illustrator is reopened every day: only the very first run
   * on a machine may pay for finding the form that works there. The save is a
   * convenience, never a requirement. Missing, wiped with CEP's cache, damaged
   * or no longer right (another Illustrator version), the other forms are
   * still tried and the winner is saved again.
   */
  var WIN_FORM_KEY = "deco.run.winForm";
  var winFormThatWorked = null;
  /* The .bat of the previous Windows run, removed when the next one starts. */
  var lastWinBat = null;
  try { if (IS_WIN) winFormThatWorked = window.localStorage.getItem(WIN_FORM_KEY); } catch (eLs) {}

  function cepFs() { return window.cep && window.cep.fs; }
  function cepProc() { return window.cep && window.cep.process; }

  function ensureWorkDir() {
    var fs = cepFs();
    if (fs && fs.makedir) { try { fs.makedir(WORK); } catch (e) {} }
    return WORK;
  }

  function writeText(path, text) {
    var fs = cepFs();
    if (!fs) throw new Error("CEP_FS_UNAVAILABLE");
    var r = fs.writeFile(path, text);
    if (r && r.err) throw new Error("WRITE_FAILED_" + r.err);
  }

  function readText(path) {
    var fs = cepFs();
    if (!fs) return null;
    var r = fs.readFile(path);
    if (!r || r.err) return null;
    return r.data;
  }

  function exists(path) {
    var fs = cepFs();
    if (!fs || !fs.stat) return false;
    var r = fs.stat(path);
    return !!(r && !r.err);
  }

  function removeIfPresent(path) {
    var fs = cepFs();
    try { if (fs && fs.deleteFile && exists(path)) fs.deleteFile(path); } catch (e) {}
  }

  /*
   * A .zxp is a signed archive and the installer does not reliably preserve the
   * executable bit, so a perfectly good binary can land unlaunchable. Set it
   * once per session; harmless when already set, and skipped on Windows.
   */
  var chmodDone = false;
  function ensureExecutable() {
    if (chmodDone) return;
    chmodDone = true;
    var proc = cepProc();
    if (!proc || !proc.createProcess) return;
    if (IS_WIN) {
      /*
       * Windows marks anything that arrived from a download, and the mark
       * travels into the files unpacked from it. An engine carrying it can be
       * refused at launch, which would look exactly like the macOS failure a
       * designer hit: no dialog, no output.
       *
       * The mark lives beside the file, not inside it, so nothing on our side
       * can stop it being applied -- only removed afterwards, which is what
       * this does. UNTESTED on a real Windows machine: it is written to be
       * harmless if it does nothing, never to be the reason a run fails.
       */
      try {
        proc.createProcess(WIN_CMD[0], "/c",
          'powershell -NoProfile -Command "Unblock-File -LiteralPath \'' + BIN + '\'"');
      } catch (eW) {}
      return;
    }
    /* Nothing to do on macOS any more: the engine we actually run is our own
     * copy, and ensureLocalBinary sets its permissions in the same shell that
     * makes it. Spawning a second process to chmod a file we never launch was
     * one more thing CEP had to start, and CEP's process table is the scarce
     * resource here. */
  }

  /*
   * Run from OUR OWN copy of the engine, not from the installed one.
   *
   * A .zxp arrives by download, so macOS stamps everything inside it with
   * com.apple.quarantine and Gatekeeper kills the solver the instant it starts:
   * no dialog, no output, just "Operation not permitted" in the log. A
   * designer's Mac did exactly that while the same build ran fine on the
   * machine that made it, where the flag never existed.
   *
   * Clearing the flag in place looks like the obvious repair and is not
   * reliable: the panel installs into /Library, so whether it may write there
   * at all depends on which account ran the installer. Copying the engine into
   * our own scratch directory sidesteps the question -- we own that copy, so
   * chmod and xattr always succeed on it, whoever owns the installed bundle.
   *
   * The ad-hoc code signature lives inside the file, so the copy stays signed
   * and Apple Silicon still accepts it.
   *
   * REFRESHED whenever the installed engine differs from the copy (3.8.1).
   * The copy used to be made only when none existed, so an update that
   * brought a new engine went on running the OLD copy from /tmp until the Mac
   * restarted and emptied /tmp: the crash fixed in 3.8.1 would have stayed on
   * every Mac that had nested once before. The shell now compares the two
   * files byte for byte, copies when they differ, and writes down which way it
   * went. The check is made the first time a session needs the engine (each
   * time Illustrator opens the panel). A copy the shell has not answered "ok"
   * for is not run; once it has, the copy is trusted until the panel closes.
   *
   * The new copy is written beside the old one and RENAMED over it, never
   * rewritten in place. macOS remembers the code signature it checked for a
   * file, a file rewritten in place no longer matches it, and the next launch
   * is killed on sight. An engine still running from the old copy keeps its
   * own file: a rename does not touch it.
   */
  var localBin = null;
  /* A copy the shell answered "fail" for, remembered for the session: the
   * same files fail the same way again, and every run of a multi-sheet job or
   * of a crash retry used to wait for that answer anew (review of 3.8.1). A
   * copy that never answered is tried again next time: it may only have been
   * slow, and a slow copy has landed by then. */
  var localCopyFailed = false;
  function localCopyScript(src, dst, ready, stamp) {
    var tmp = dst + ".incoming";
    var dir = dst.replace(/\/[^\/]*$/, "");
    return "mkdir -p " + shellQuote(dir) +
           " && { cmp -s " + shellQuote(src) + " " + shellQuote(dst) +
           " || { cp -f " + shellQuote(src) + " " + shellQuote(tmp) +
           " && chmod +x " + shellQuote(tmp) +
           " && mv -f " + shellQuote(tmp) + " " + shellQuote(dst) + " ; } ; }" +
           " ; chmod +x " + shellQuote(dst) + " 2>/dev/null" +
           " ; xattr -c " + shellQuote(dst) + " 2>/dev/null" +
           " ; if cmp -s " + shellQuote(src) + " " + shellQuote(dst) + " && [ -x " + shellQuote(dst) + " ]" +
           " ; then echo " + shellQuote(stamp + " ok") + " > " + shellQuote(ready) +
           " ; else echo " + shellQuote(stamp + " fail") + " > " + shellQuote(ready) + " ; fi";
  }
  function ensureLocalBinary(done) {
    if (IS_WIN) { done(BIN); return; }
    if (localBin) { done(localBin); return; }
    if (localCopyFailed) { done(BIN); return; }
    var proc = cepProc();
    if (!proc || !proc.createProcess) { done(BIN); return; }

    var dst = WORK + "/bin/sparrow";
    var stamp = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
    /* The answer goes to a file of its OWN, named after this stamp, in the
     * work folder rather than in bin. One shared answer file let a second
     * panel's refresh write its "ok" over this one's before it was read, so
     * this panel waited out its five seconds and ran the installed engine;
     * and a bin folder it may not write into left no answer at all, so every
     * run paid those five seconds (review of 3.8.1). */
    var ready = WORK + "/copy-ready-" + stamp + ".txt";
    var spawned = null;
    try { spawned = proc.createProcess("/bin/sh", "-c", localCopyScript(BIN, dst, ready, stamp)); }
    catch (e) { done(BIN); return; }
    /* Refused outright: no answer is coming, so there is nothing to wait for. */
    if (spawned && spawned.err) { done(BIN); return; }

    /* createProcess does not wait, and a 5 MB copy is not instant. Wait for
     * the shell's own answer, carrying THIS stamp, instead of guessing a delay
     * or trusting a file that merely exists: a stale copy exists too. Fall
     * back to the installed engine rather than refuse to run at all. */
    var tries = 0;
    var t = setInterval(function () {
      var said = readText(ready) || "";
      if (said.indexOf(stamp + " ok") >= 0) { clearInterval(t); removeIfPresent(ready); localBin = dst; done(dst); return; }
      if (said.indexOf(stamp + " fail") >= 0) { clearInterval(t); removeIfPresent(ready); localCopyFailed = true; done(BIN); return; }
      if (++tries > 50) { clearInterval(t); done(BIN); }
    }, 100);
  }

  function shellQuote(s) { return '"' + String(s).replace(/(["\\$`])/g, "\\$1") + '"'; }

  /* Where the engine crashed, as "panicked at worker.rs:59:51": the source
   * file's own name and position, nothing more. The full path names the
   * engine's source folders, and on the machine that built it a home folder. */
  function crashDetail(log) {
    log = log || "";
    var m = /panicked at ([^\r\n]*?):(\d+):(\d+)/.exec(log);
    if (m) return "panicked at " + m[1].replace(/^.*[\\\/]/, "") + ":" + m[2] + ":" + m[3];
    /* A crash that is not a panic: the runtime's own line, which names no
     * folder ("fatal runtime error: stack overflow", "memory allocation of
     * 1073741824 bytes failed"). */
    var f = /fatal runtime error:[^\r\n]*/.exec(log) || /memory allocation of \d+ bytes failed/.exec(log) ||
            /has overflowed its stack/.exec(log);
    return f ? f[0].substring(0, 100) : "";
  }

  /*
   * Windows status codes of a process that CRASHED, as the .bat's %ERRORLEVEL%
   * writes them (a signed 32-bit number): access violation, illegal
   * instruction, integer division by zero, out of memory, stack overflow, heap
   * corruption, and the fast fail a Rust abort ends with. A missing DLL
   * (0xC0000135) is deliberately not one of them: that engine never started,
   * and the message says so.
   */
  var WIN_CRASH_STATUS = [0xC0000005, 0xC000001D, 0xC0000094, 0xC0000017, 0xC00000FD, 0xC0000374, 0xC0000409]
    .map(function (s) { return s | 0; });
  function crashedWith(exitCode) {
    if (typeof exitCode !== "number" || !isFinite(exitCode)) return false;
    /* | 0 reads an unsigned 3221226505 as the -1073740791 cmd.exe prints. */
    return exitCode === 101 || WIN_CRASH_STATUS.indexOf(exitCode | 0) >= 0;
  }

  /*
   * What the solver's log actually says went wrong.
   *
   * Pure, and exported, so it can be exercised against real log lines instead
   * of being taken on trust. "It produced nothing" used to cover half a dozen
   * different repairs, and on a customer machine the cause is almost never the
   * geometry: it is the machine refusing to run the binary. The shell writes
   * the reason down every time, in its own words.
   *
   * Order matters. The polygon complaint is checked FIRST because the solver
   * only writes it once it is running, and a running solver rules out every
   * machine-level cause below it.
   */
  function classifyLog(log, exitCode) {
    log = log || "";
    if (/intersecting edges|Simple polygon|duplicate vertices/.test(log))
      return "SPARROW_BAD_POLYGON";
    /* The engine CRASHED (3.8.1). A Rust panic prints "panicked at <file>:<line>"
     * and exits with 101; on Windows that code reaches the panel through the
     * .bat's own "done" line even when the log is empty. A crash is neither a
     * machine refusing the engine nor a shape it could not read: it follows
     * the search's path, so the panel retries the same outline with another
     * seed first. Checked right after the polygon complaint, for the same
     * reason that one comes first: an engine that panicked was running. The
     * crash met in 3.8 (upstream issue #160) came back on every run of the
     * kit with the same seed, and was reported as "produced nothing".
     * Not only a panic: a stack overflow and memory running out end the run
     * with a line of their own, and on Windows a crash status code with an
     * empty log read as "never started", with no retry at all (review of
     * 3.8.1). */
    if (/panicked at|fatal runtime error|has overflowed its stack|memory allocation of \d+ bytes failed/.test(log) ||
        crashedWith(exitCode)) return "SOLVER_CRASHED";
    /* Wrong processor: an Apple Silicon build on an Intel Mac, or the reverse.
     * No setting repairs this, only a build for that machine. */
    if (/bad cpu type|cannot execute binary file|exec format error/i.test(log))
      return "SOLVER_WRONG_ARCH";
    /* Gatekeeper: the binary arrived inside a download, so macOS quarantines it
     * and kills it on sight, with no dialog and no output. */
    if (/cannot be opened|developer cannot be verified|killed|operation not permitted/i.test(log))
      return "SOLVER_BLOCKED";
    if (/permission denied/i.test(log)) return "SOLVER_NOT_EXECUTABLE";
    if (/no such file/i.test(log)) return "SPARROW_BINARY_MISSING";
    if (!log) return "SOLVER_NEVER_STARTED";
    return "SOLVER_WROTE_NOTHING";
  }

  /*
   * Run the solver.
   *   instance  the jagua-rs instance object from SparrowBridge.buildInstance
   *   opts      { seconds, separationMm, seed, onLog }
   * Resolves with the parsed solution JSON; rejects with a code main.js maps to
   * an operator-readable sentence.
   */
  function run(instance, opts) {
    var o = opts || {};
    var seconds = Math.max(1, Math.round(o.seconds || 30));
    var sep = o.separationMm || 0;
    /* Measured on a real kit, 60 s: one search on 8 threads reaches 894.8 mm
     * where SIX independent searches on one thread each reach only 909.3 mm.
     * Sparrow improves a single layout continuously, so concentrating the
     * machine on one search beats the random-restart strategy the built-in
     * placer needed. Leave one core for Illustrator and the panel. */
    var cores = 0;
    try { cores = navigator.hardwareConcurrency || 0; } catch (e) {}
    var workers = Math.max(1, Math.min(16, (cores || 4) - 1));

    return new Promise(function (resolve, reject) {
      var proc = cepProc(), fs = cepFs();
      if (!proc || !proc.createProcess) { reject(new Error("CEP_PROCESS_UNAVAILABLE")); return; }
      if (!fs) { reject(new Error("CEP_FS_UNAVAILABLE")); return; }
      if (!exists(BIN)) { reject(new Error("SPARROW_BINARY_MISSING")); return; }
      ensureExecutable();
      ensureWorkDir();
      ensureLocalBinary(function (engine) { start(engine); });

      function start(ENGINE) {
      var dir = ensureWorkDir();
      var inPath = dir + "/instance.json";
      var logPath = dir + "/solver.log";
      var outPath = dir + "/output/final_" + instance.name + ".json";

      /* A stale solution would be read back as if it belonged to this run, and
       * the operator would apply yesterday's sheet to today's kit. */
      removeIfPresent(outPath);
      removeIfPresent(logPath);
      /* A log an earlier engine still holds open cannot be deleted on Windows.
       * Remembered, so it is never taken for THIS run having started. */
      var logSurvived = exists(logPath);
      if (exists(outPath)) { reject(new Error("STALE_SOLUTION_LOCKED")); return; }

      try { writeText(inPath, JSON.stringify(instance)); }
      catch (e) { reject(e); return; }

      /* cd FIRST: the solver writes to <cwd>/output/ and offers no way to say
       * otherwise. Then send both streams to a file, because CEP does not hand
       * them back reliably and the retry ladder needs to read them. */
      var cmd, winForms = null, winMarks = null, launchedAs = "";
      if (IS_WIN) {
        /*
         * Through a .bat file, not a command line.
         *
         * cmd.exe re-parses the quotes of a /c command line by rules that
         * depend on its first character and on how the caller joined the
         * arguments -- and CEP does that joining out of sight. One space in a
         * path, C:\Users\John Smith, is enough to break it, silently. A .bat
         * keeps every quoted path on its own line, and cmd.exe is handed a
         * single path with nothing inside it to re-parse.
         */
        var win = function (p) { return p.replace(/\//g, "\\"); };
        /*
         * Two markers written BY THE .BAT ITSELF, each carrying this run's stamp.
         *
         * "started" is its first action: proof that Windows really ran the file.
         * Without it "the engine produced nothing" and "the .bat never ran" look
         * exactly alike, and 3.6 left a designer's PC with no way to say which.
         * "done" is its last action, with the engine's exit code, and on Windows
         * it is that line -- not CEP's isRunning -- which says the engine has
         * finished: nothing seen on a real PC proves isRunning told the truth
         * there. The stamp stops a file left by an earlier run from answering
         * for this one.
         *
         * The redirection comes FIRST on those lines: in "echo x exit=1> file"
         * cmd.exe would read "1>" as a stream number and write nothing.
         */
        var stamp = "r" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
        winMarks = { stamp: stamp, started: dir + "/started.txt", done: dir + "/done.txt" };
        /* Old markers go BEFORE anything reads them. A read that catches
         * cmd.exe opening started.txt for writing can make that write fail
         * (review of 3.7), and a missing file holds no handle. */
        removeIfPresent(winMarks.started);
        removeIfPresent(winMarks.done);
        /*
         * One .bat PER RUN, and the previous one removed. cmd.exe reads a batch
         * file line by line, reopening it at a saved position. Rewriting the
         * same run.bat for the next sheet while the last cmd.exe was still on
         * its final line made that cmd.exe run a line of the NEW file: the next
         * run's "done" marker, stamp and all, so a sheet still being nested
         * looked finished. A removed file only stops the old cmd.exe early,
         * after its own result has already been read back.
         */
        var batPath = dir + "/run-" + stamp + ".bat";
        if (lastWinBat && lastWinBat !== batPath) removeIfPresent(lastWinBat);
        lastWinBat = batPath;
        /*
         * The engine's path, as the .bat must spell it. An account name with an
         * accent or a % (C:\Users\Aurélien) must not be written as bytes: cmd.exe
         * reads the file in the machine's old code page, and chcp only helps
         * when cmd.exe has a console, which CEP may not give it. %APPDATA% is
         * expanded by cmd.exe itself, from the environment, where no code page
         * is involved. A remaining % is doubled so it is not read as a variable.
         * The plain case, the one proven on a real PC, is written as before.
         */
        var engWin = ENGINE.replace(/\//g, "\\");
        var dataWin = (WIN_DATA || "").replace(/\//g, "\\");
        var enginePathBat = engWin.replace(/%/g, "%%");
        if (dataWin && /[^\x20-\x7e]|%/.test(dataWin) &&
            engWin.toLowerCase().indexOf(dataWin.toLowerCase()) === 0) {
          enginePathBat = "%APPDATA%" + engWin.substring(dataWin.length).replace(/%/g, "%%");
        }
        var engineLine = '"' + enginePathBat + '"' +
                         ' -i "' + win(inPath) + '" -t ' + seconds + ' -s ' + (o.seed || 1) +
                         (sep > 0 ? " --min-item-separation " + sep : "") +
                         " --workers " + workers +
                         ' > "' + win(logPath) + '" 2>&1';
        /* cmd.exe reads a .bat in the machine's old code page and this file is
         * written in UTF-8, so an accented account name (C:\Users\Aurélien)
         * would reach it garbled. Switch cmd.exe to UTF-8 only then: a plain
         * path gets no extra step. */
        var utf8 = /[^\x00-\x7f]/.test(engineLine + dir);
        /* The leading blank line absorbs a byte-order mark if one is ever written. */
        var bat = "\r\n@echo off\r\n" +
                  (utf8 ? "chcp 65001 >nul\r\n" : "") +
                  '> "' + win(winMarks.started) + '" echo ' + stamp + "\r\n" +
                  'cd /d "' + win(dir) + '"\r\n' +
                  engineLine + "\r\n" +
                  '> "' + win(winMarks.done) + '" echo ' + stamp + " exit=%ERRORLEVEL%\r\n";
        try { writeText(batPath, bat); }
        catch (eBat) { reject(eBat); return; }
        /*
         * THREE ways of handing Windows that .bat, tried in this order.
         *
         * PowerShell starting cmd.exe with the path in quotes works on a
         * designer's PC; the panel starting it through CEP with the very same
         * quoted string did not. The likely cause is CEP protecting the
         * argument itself and damaging the quotes inside it. That cannot be
         * watched from here, so the panel stops betting on a single form:
         *   unquoted  cmd.exe /c <path>. The work path never holds a space.
         *   direct    the .bat named as the program. Windows starts cmd.exe for
         *             it, so neither "/c" nor a quote goes through CEP.
         *   capture   cmd.exe /c <path> 2><launch-err.txt>, last. It replaces
         *             the 3.6 quoted form, which the space-free work path made
         *             pointless, and it is the one that can say WHY: cmd.exe
         *             writes its own refusal into that file ("is not
         *             recognized", "Access is denied", "blocked by group
         *             policy"), and that line goes into the error detail.
         * The "started" marker says which one really ran. A form that never
         * gets there is stopped before the next one starts, so two engines
         * never write the same files.
         */
        var errPath = dir + "/launch-err.txt";
        winForms = [
          { name: "unquoted", arg: win(batPath), viaCmd: true },
          { name: "direct", arg: win(batPath), viaCmd: false },
          { name: "capture", arg: win(batPath), extra: "2>" + win(errPath), viaCmd: true, errFile: errPath }
        ];
        /* Once a form has worked, it goes first (see winFormThatWorked). */
        for (var wf = 1; wf < winForms.length; wf++) {
          if (winForms[wf].name === winFormThatWorked) { winForms.unshift(winForms.splice(wf, 1)[0]); break; }
        }
      } else {
        cmd = "cd " + shellQuote(dir) + " && " + shellQuote(ENGINE) +
              " -i " + shellQuote(inPath) + " -t " + seconds + " -s " + (o.seed || 1) +
              (sep > 0 ? " --min-item-separation " + sep : "") +
              " --workers " + workers +
              " > " + shellQuote(logPath) + " 2>&1";
      }

      /*
       * Starting the process, with ONE retry.
       *
       * CEP keeps a table of the processes a panel has started and does not
       * always let go of them. A job that nests onto several sheets now starts
       * one search per sheet where it used to start one in total, so the table
       * fills where it never used to, and the refusal arrives as a bare
       * "SPAWN_FAILED" with no clue in it. A short pause is enough often
       * enough to be worth trying before giving up on the whole run.
       */
      function spawn(arg, extra) {
        if (arg === undefined) arg = cmd;
        try {
          if (!IS_WIN) return proc.createProcess("/bin/sh", "-c", arg);
          /* The FULL path to cmd.exe: CEP does not search PATH (see WIN_CMD). */
          var last = { err: -1 };
          for (var c = 0; c < WIN_CMD.length; c++) {
            last = extra ? proc.createProcess(WIN_CMD[c], "/c", arg, extra)
                         : proc.createProcess(WIN_CMD[c], "/c", arg);
            if (!last || last.err !== 3) return last;   // 3 = ERR_NOT_FOUND: try the next location
          }
          return last;
        } catch (e) { return { err: -1 }; }
      }
      function spawnForm(f) {
        if (f.errFile) removeIfPresent(f.errFile);
        if (f.viaCmd) return spawn(f.arg, f.extra);
        try { return proc.createProcess(f.arg); } catch (e) { return { err: -1 }; }
      }
      function spawnFailed(res) {
        var e = new Error("SPAWN_FAILED");
        /* CEP's own refusal code. Without it every cause looks the same. */
        e.detail = "CEP createProcess err=" + ((res && res.err) !== undefined ? res.err : "?");
        return e;
      }

      /* A marker counts only when it carries THIS run's stamp. */
      function said(path) {
        var t = readText(path);
        return (t && winMarks && t.indexOf(winMarks.stamp) >= 0) ? t : null;
      }

      /*
       * Windows: start one form, then wait for its "started" marker before
       * trusting it. Moving on is decided by the clock, never by isRunning: a
       * form still silent after START_WAIT_MS is stopped and the next one
       * tried. Only when every form has failed is the run abandoned, and the
       * error then says what each one did, so the next fix is read off the
       * designer's screen instead of guessed.
       */
      var START_WAIT_MS = 6000;
      function tryForm(i, tried, refused, waits) {
        if (i >= winForms.length) {
          var all = refused === winForms.length;
          var ne = new Error(all ? "SPAWN_FAILED" : "SOLVER_NEVER_STARTED");
          ne.detail = (all ? "CEP createProcess refused every launch: " : "run.bat never ran; tried: ") +
                      tried.join(", ");
          reject(ne);
          return;
        }
        var f = winForms[i];
        var res = spawnForm(f);
        if (!res || res.err) {
          var code = (res && res.err !== undefined) ? res.err : "?";
          /* Only a full process table (101) or a call that threw is worth one
           * pause; any other refusal would only say the same thing again. */
          if ((code === 101 || code === -1) && waits < 1) {
            setTimeout(function () { tryForm(i, tried, refused, waits + 1); }, 400);
            return;
          }
          tried.push(f.name + " (err=" + code + ")");
          tryForm(i + 1, tried, refused + 1, 0);
          return;
        }
        var pid = res.data, t0 = Date.now();
        var probe = setInterval(function () {
          if (said(winMarks.started)) {
            clearInterval(probe);
            launchedAs = f.name;
            if (winFormThatWorked !== f.name) {
              winFormThatWorked = f.name;
              try { window.localStorage.setItem(WIN_FORM_KEY, f.name); } catch (eLs) {}
            }
            watch(pid);
            return;
          }
          if (Date.now() - t0 < START_WAIT_MS) return;
          clearInterval(probe);
          /* The marker can be lost while the .bat goes on. solver.log is created
           * only by the engine line, so if it exists this form got past its
           * marker: watch it rather than start a second engine on top of it,
           * and do not save a form that was never seen starting. */
          if (!logSurvived && exists(logPath)) { launchedAs = f.name; watch(pid); return; }
          /* Labelled as what CEP SAID, not as fact: nothing proves isRunning
           * tells the truth on Windows. */
          var what = "isRunning:?";
          try {
            var st = proc.isRunning ? proc.isRunning(pid) : null;
            if (st && st.data === true) what = "isRunning:running";
            else if (st && st.data === false) what = "isRunning:exited";
          } catch (eR) {}
          try { if (proc.terminate) proc.terminate(pid); } catch (eT) {}
          if (f.errFile) {
            var errText = readText(f.errFile) || "", errLine = "";
            var errLines = errText.split(/[\r\n]+/);
            for (var el = 0; el < errLines.length && !errLine; el++) {
              if (errLines[el].replace(/\s/g, "")) errLine = errLines[el];
            }
            /* No file at all means cmd.exe never even got to the redirection:
             * refused or killed as it started. */
            what += ", " + (errLine ? errLine.substring(0, 100) : "no launch-err");
          }
          tried.push(f.name + " (" + what + ")");
          tryForm(i + 1, tried, refused, 0);
        }, 100);
      }

      if (IS_WIN) { tryForm(0, [], 0, 0); return; }

      var started = spawn();
      if (!started || started.err) {
        /* Only a FULL process table (101, ERR_EXCEED_MAX_NUM_PROCESS) is worth
         * waiting out. A program that was not found (3) will still be missing
         * 400 ms later, so that fails at once with its real code. */
        if (started && started.err !== 101 && started.err !== -1) { reject(spawnFailed(started)); return; }
        setTimeout(function () {
          var again = spawn();
          if (!again || again.err) { reject(spawnFailed(again)); return; }
          watch(again.data);
        }, 400);
        return;
      }
      watch(started.data);

      function watch(pid) {

      /*
       * Read the solver's own words from the log rather than from CEP.
       *
       * "It produced nothing" was one answer covering half a dozen different
       * repairs, and on a customer machine it is almost never the geometry: it
       * is the machine refusing to run the binary. The shell writes the reason
       * into the log, in its own words, and those words each mean something
       * different to do about it. A designer sat on "SOLVER_WROTE_NOTHING"
       * while the log said what was wrong the whole time.
       */
      /* The error carries the log's own first line, so an unforeseen cause is
       * still visible to whoever is reading the panel. */
      function failure() {
        var log = readText(logPath) || "";
        if (o.onLog && log) o.onLog(log);
        /* On Windows the .bat's "done" line holds the engine's exit code, and
         * 101 is a crash even when the log is empty. */
        var doneLine = winMarks ? (said(winMarks.done) || "") : "";
        var ex = /exit=(-?\d+)/.exec(doneLine);
        var code = classifyLog(log, ex ? Number(ex[1]) : null);
        var e = new Error(code);
        var lines = log.split(/[\r\n]+/), pick = "";
        for (var i = 0; i < lines.length && !pick; i++) {
          if (lines[i].replace(/\s/g, "")) pick = lines[i];
        }
        /* For a crash, where it happened says more than the log's first line. */
        if (code === "SOLVER_CRASHED") pick = crashDetail(log) || pick;
        e.detail = pick.substring(0, 160);
        /* On Windows, say how far it got: which form ran the .bat, and what the
         * engine returned. A crash that writes nothing still has an exit code. */
        if (winMarks) {
          var how = "run.bat ran (" + (launchedAs || "?") + "), engine exit=" + (ex ? ex[1] : "?");
          e.detail = pick ? pick.substring(0, 120) + " / " + how : how + ", empty log";
        }
        return e;
      }

      /* Poll rather than trust an exit callback: CEP's onquit is unreliable
       * across host versions, and a solver that dies must not hang the panel. */
      var deadline = Date.now() + (seconds + 30) * 1000;
      var sawExit = 0, badParse = 0, lastGood = null, lastSig = 0;
      /* Journal d'arrêt : une seule ligne, au premier tour, pour dire ce que le
         pont voit réellement du bouton Stop. Deux corrections « sûres » ont
         échoué faute de savoir lequel des trois maillons cassait — le panneau
         qui n'expose pas la fonction, la fonction qui répond faux, ou le
         processus qui refuse d'être tué. */
      var stopDiagDone = false, stopSeen = false;
      var timer = setInterval(function () {
        if (!stopDiagDone) {
          stopDiagDone = true;
          var dispo = !!(typeof window !== 'undefined' && window.MXNestSpirit &&
                         typeof window.MXNestSpirit.isCancelled === 'function');
          var peutTuer = !!(proc && typeof proc.terminate === 'function');
          /* On ne le dit plus que si quelque chose manque : quand tout va bien,
             cette ligne n'apprend rien et encombre le journal. */
          if ((!dispo || !peutTuer) && o.onLog) {
            o.onLog('[STOP] fonction d\'arrêt visible : ' + (dispo ? 'OUI' : 'NON') +
                    ' · terminaison possible : ' + (peutTuer ? 'OUI' : 'NON'));
          }
        }
        /* ARRÊT DEMANDÉ — testé EN PREMIER.
         * Il était placé en fin de tour, après un bloc qui sort de la boucle
         * dès qu'un fichier de solution existe : autant dire qu'il n'était
         * jamais atteint, et que le bouton Stop ne servait à rien. */
        if (typeof window !== 'undefined' && window.MXNestSpirit &&
            window.MXNestSpirit.isCancelled && window.MXNestSpirit.isCancelled()) {
          clearInterval(timer);
          var tue = 'non tenté';
          try {
            if (proc && typeof proc.terminate === 'function') { proc.terminate(pid); tue = 'terminate() appelé'; }
            else if (proc && typeof proc.killPid === 'function') { proc.killPid(pid); tue = 'killPid() appelé'; }
            else tue = 'aucune méthode de terminaison';
          } catch (eK) { tue = 'échec : ' + String(eK); }
          if (o.onLog) o.onLog('[STOP] arrêt pris en compte · ' + tue +
                               ' · solution en réserve : ' + (lastGood ? 'oui' : 'non'));
          if (lastGood) { resolve(lastGood); return; }
          reject(new Error('SOLVER_CANCELLED'));
          return;
        }
        var running = true;
        if (winMarks) {
          /* The .bat's own last line, not CEP's isRunning (see winMarks). */
          running = !said(winMarks.done);
        } else {
          try {
            var st = proc.isRunning ? proc.isRunning(pid) : null;
            if (st && st.data === false) running = false;
          } catch (e) {}
        }

        /* The file appears the moment the solver starts writing it, so reading
         * on sight can catch it half-written -- which parsed as garbage and was
         * reported as a corrupt solution when nothing was wrong. Keep trying
         * until it parses, or until the process is gone and it still will not. */
        if (exists(outPath)) {
          var txt = readText(outPath);
          if (txt) {
            var parsed = null;
            try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }
            if (parsed) {
              /* NE PAS PRENDRE LA PREMIÈRE SOLUTION LISIBLE.
               *
               * Sparrow réécrit son fichier de solution à chaque amélioration,
               * et une solution intermédiaire est un JSON parfaitement valide
               * où toutes les pièces ne sont pas encore posées. En lisant dès
               * que ça parse, on attrapait parfois cet état-là : le plan
               * revenait avec des pièces en moins, de façon apparemment
               * aléatoire — selon le moment où le disque répondait — puis
               * rentrait dans l'ordre tout seul à l'essai suivant.
               *
               * On garde donc la dernière solution lisible et on ne rend la
               * main que lorsque le solveur a terminé. En cas de dépassement
               * du temps imparti, on rend la meilleure obtenue plutôt que
               * d'échouer : c'est exactement ce que Sparrow avait trouvé au
               * moment où on l'a arrêté. */
              /* Chaque réécriture du fichier est une amélioration trouvée par
                 le solveur. On la signale au panneau pour qu'il la dessine :
                 on voit la planche se resserrer en direct, au lieu de fixer
                 une barre d'attente pendant une minute. */
              var sig = JSON.stringify(parsed).length;
              if (sig !== lastSig) {
                lastSig = sig;
                if (o.onSolution) { try { o.onSolution(parsed); } catch (eS) {} }
              }
              lastGood = parsed;
              if (!running) { clearInterval(timer); resolve(parsed); return; }
              return;
            }
            if (!running && ++badParse > 8) {
              clearInterval(timer);
              if (lastGood) { clearInterval(timer); resolve(lastGood); return; }
              reject(new Error("SOLUTION_UNREADABLE"));
              return;
            }
            return;   // still being written: come back next tick
          }
        }

        // The process can exit a beat before the file lands; allow a few ticks
        // before calling it a failure rather than losing a good run to a race.
        if (!running && ++sawExit > 4) {
          clearInterval(timer);
          if (lastGood) { resolve(lastGood); return; }
          reject(failure());
          return;
        }

        if (Date.now() > deadline) {
          clearInterval(timer);
          try { if (proc.terminate) proc.terminate(pid); } catch (e) {}
          if (lastGood) { resolve(lastGood); return; }
          reject(new Error("SOLVER_TIMEOUT"));
        }
      }, 250);
      }   // watch()
      }   // start()
    });
  }

  function diagnose() {
    var fs = cepFs(), proc = cepProc();
    var d = {
      extension: EXT,
      binary: BIN,
      windows: IS_WIN,
      cepFs: !!fs,
      cepFsStat: !!(fs && fs.stat),
      cepProcess: !!proc,
      createProcess: !!(proc && proc.createProcess),
      binaryExists: false,
      statErr: null
    };
    if (fs && fs.stat) {
      try {
        var r = fs.stat(BIN);
        d.statErr = r && r.err !== undefined ? r.err : null;
        d.binaryExists = !!(r && !r.err);
      } catch (e) { d.statErr = String(e && e.message || e); }
    }
    return d;
  }

  function available() {
    var d = diagnose();
    return !!(d.cepProcess && d.createProcess && d.cepFs && d.cepFsStat && d.binaryExists);
  }

  /* Called at panel start so the executable bit is already set by the time the
   * operator presses Nest, instead of racing the first run. */
  function warmup() { if (available()) { ensureWorkDir(); ensureExecutable(); } }

  window.SparrowRun = {
    run: run, available: available, diagnose: diagnose, warmup: warmup, classifyLog: classifyLog,
    localCopyScript: localCopyScript, crashDetail: crashDetail,
    binaryPath: BIN, workDir: WORK
  };
  try { warmup(); } catch (e) {}
})();

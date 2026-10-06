// Ishikawa para Windows: serve o app embutido em http://localhost e abre uma janela de aplicativo (Edge/Chrome).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Ishikawa")]
[assembly: AssemblyProduct("Ishikawa")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    const int Port = 47833;

    static readonly Dictionary<string, string> Mime = new Dictionary<string, string> {
        { ".html", "text/html; charset=utf-8" }, { ".css", "text/css; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
        { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".ico", "image/x-icon" }, { ".webmanifest", "application/manifest+json" }
    };

    static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Ishikawa"); } }

    [STAThread]
    static int Main(string[] args)
    {
        string url = "http://localhost:" + Port + "/";
        bool serveOnly = Array.IndexOf(args, "--serve") >= 0;

        // Se a porta já estiver em uso, outra janela do Ishikawa já está servindo o app.
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add(url);
        bool owner = true;
        try { listener.Start(); } catch (HttpListenerException) { owner = false; }
        if (owner)
        {
            Thread t = new Thread(delegate() { Serve(listener); });
            t.IsBackground = true;
            t.Start();
        }
        if (serveOnly)
        {
            if (!owner) return 1;
            Thread.Sleep(Timeout.Infinite);
        }

        string browser = FindBrowser();
        if (browser == null)
        {
            Process.Start(url);
            if (owner) MessageBox.Show("O Ishikawa foi aberto no seu navegador.\nMantenha esta janela aberta enquanto usa; clique em OK para encerrar.", "Ishikawa");
            return 0;
        }

        string profile = Path.Combine(DataDir, "profile");
        Directory.CreateDirectory(profile);
        ProcessStartInfo psi = new ProcessStartInfo(browser,
            "--app=" + url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-background-mode --window-size=1360,860");
        psi.UseShellExecute = false;
        using (Process p = Process.Start(psi))
        {
            if (owner) p.WaitForExit();
        }
        return 0;
    }

    static void Serve(HttpListener listener)
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { break; }
            ThreadPool.QueueUserWorkItem(delegate { Handle(ctx); });
        }
    }

    static void Handle(HttpListenerContext ctx)
    {
        try
        {
            string path = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath).TrimStart('/');
            if (path.Length == 0) path = "index.html";
            if (path.StartsWith("api/")) { Api(ctx, path.Substring(4)); return; }
            Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app/" + path);
            if (s == null)
            {
                ctx.Response.StatusCode = 404;
                ctx.Response.Close();
                return;
            }
            using (s)
            {
                string mime;
                if (!Mime.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out mime)) mime = "application/octet-stream";
                ctx.Response.ContentType = mime;
                ctx.Response.ContentLength64 = s.Length;
                ctx.Response.AddHeader("Cache-Control", "no-cache");
                s.CopyTo(ctx.Response.OutputStream);
            }
            ctx.Response.Close();
        }
        catch
        {
            try { ctx.Response.Abort(); } catch { }
        }
    }

    // ---------- Sincronização com uma pasta (Google Drive para computador) ----------

    static string ConfigFile { get { return Path.Combine(DataDir, "sync.txt"); } }

    // Cada conta do Google Drive para computador aparece como uma unidade própria (G:, H:, ...).
    static List<string> DetectDrives()
    {
        List<string> found = new List<string>();
        try
        {
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                if (!d.IsReady) continue;
                foreach (string name in new string[] { "Meu Drive", "My Drive" })
                {
                    string p = Path.Combine(d.RootDirectory.FullName, name);
                    if (Directory.Exists(p)) { found.Add(Path.Combine(p, "Ishikawa")); break; }
                }
            }
        }
        catch { }
        return found;
    }

    static string DetectDrive()
    {
        List<string> all = DetectDrives();
        return all.Count > 0 ? all[0] : null;
    }

    // Sem configuração: usa o Google Drive se ele existir. "off": desativado. Qualquer outro texto: pasta escolhida.
    static string SyncFolder()
    {
        string cfg = File.Exists(ConfigFile) ? File.ReadAllText(ConfigFile).Trim() : "";
        if (cfg == "off") return null;
        return cfg.Length > 0 ? cfg : DetectDrive();
    }

    static string Json(string s)
    {
        return s == null ? "null" : "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static void Reply(HttpListenerContext ctx, int status, string mime, byte[] body)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = mime;
        ctx.Response.AddHeader("Cache-Control", "no-store");
        ctx.Response.ContentLength64 = body.Length;
        ctx.Response.OutputStream.Write(body, 0, body.Length);
        ctx.Response.Close();
    }

    static void ReplyInfo(HttpListenerContext ctx)
    {
        string folder = SyncFolder();
        List<string> drives = DetectDrives();
        string list = "";
        foreach (string d in drives) list += (list.Length > 0 ? "," : "") + Json(d);
        string json = "{\"enabled\":" + (folder != null ? "true" : "false") + ",\"folder\":" + Json(folder) + ",\"detected\":" + Json(drives.Count > 0 ? drives[0] : null) + ",\"drives\":[" + list + "]}";
        Reply(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
    }

    // As janelas do Windows precisam de uma thread STA própria; o formulário invisível as mantém à frente do app.
    static string Dialog(Func<Form, string> show)
    {
        string result = null;
        Thread t = new Thread(delegate()
        {
            using (Form owner = new Form())
            {
                owner.TopMost = true;
                result = show(owner);
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return result;
    }

    static string ChooseFolder()
    {
        return Dialog(delegate(Form owner)
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = "Escolha a pasta onde o Ishikawa guarda a cópia sincronizada (por exemplo, dentro do Google Drive).";
                return d.ShowDialog(owner) == DialogResult.OK ? d.SelectedPath : null;
            }
        });
    }

    // ---------- Exportação em PDF (impressão sem janela pelo Edge/Chrome) ----------

    static string lastPdf;

    static string ChoosePdf(string name)
    {
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, ' ');
        return Dialog(delegate(Form owner)
        {
            using (SaveFileDialog d = new SaveFileDialog())
            {
                d.Title = "Salvar diagrama em PDF";
                d.Filter = "Documento PDF (*.pdf)|*.pdf";
                d.DefaultExt = "pdf";
                d.AddExtension = true;
                d.FileName = name.Trim() + ".pdf";
                return d.ShowDialog(owner) == DialogResult.OK ? d.FileName : null;
            }
        });
    }

    static bool PrintToPdf(string html, string target)
    {
        string browser = FindBrowser();
        if (browser == null) return false;
        Directory.CreateDirectory(DataDir);
        string src = Path.Combine(DataDir, "print.html"), tmp = Path.Combine(DataDir, "print.pdf");
        File.WriteAllText(src, html, new UTF8Encoding(false));
        if (File.Exists(tmp)) File.Delete(tmp);
        ProcessStartInfo psi = new ProcessStartInfo(browser,
            "--headless --disable-gpu --no-first-run --no-pdf-header-footer --user-data-dir=\"" + Path.Combine(DataDir, "headless") + "\" --print-to-pdf=\"" + tmp + "\" \"" + new Uri(src).AbsoluteUri + "\"");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        using (Process p = Process.Start(psi))
        {
            if (!p.WaitForExit(60000)) { try { p.Kill(); } catch { } }
        }
        try { File.Delete(src); } catch { }
        if (!File.Exists(tmp) || new FileInfo(tmp).Length == 0) return false;
        File.Copy(tmp, target, true);
        File.Delete(tmp);
        return true;
    }

    static void Api(HttpListenerContext ctx, string route)
    {
        // Só a própria página do Ishikawa pode usar a API: o cabeçalho próprio impede chamadas vindas de outros sites.
        string origin = ctx.Request.Headers["Origin"];
        if (ctx.Request.Headers["X-Ishikawa"] != "1" || (origin != null && origin != "http://localhost:" + Port))
        {
            Reply(ctx, 403, "text/plain", new byte[0]);
            return;
        }
        bool post = ctx.Request.HttpMethod == "POST";
        byte[] body = new byte[0];
        if (post)
        {
            using (MemoryStream ms = new MemoryStream()) { ctx.Request.InputStream.CopyTo(ms); body = ms.ToArray(); }
        }
        if (route == "sync/info") { ReplyInfo(ctx); return; }
        if (route == "sync/config" && post)
        {
            string v = Encoding.UTF8.GetString(body).Trim();
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(ConfigFile, v == "auto" ? "" : v);
            ReplyInfo(ctx);
            return;
        }
        if (route == "sync/choose" && post)
        {
            string chosen = ChooseFolder();
            if (chosen != null)
            {
                Directory.CreateDirectory(DataDir);
                File.WriteAllText(ConfigFile, chosen);
            }
            ReplyInfo(ctx);
            return;
        }
        if (route == "sync")
        {
            string folder = SyncFolder();
            if (folder == null) { Reply(ctx, 409, "text/plain", new byte[0]); return; }
            string file = Path.Combine(folder, "ishikawa-sync.json");
            if (post)
            {
                Directory.CreateDirectory(folder);
                string tmp = Path.Combine(DataDir, "sync.tmp");
                File.WriteAllBytes(tmp, body);
                File.Copy(tmp, file, true);
                File.Delete(tmp);
                Reply(ctx, 200, "text/plain", new byte[0]);
            }
            else if (File.Exists(file)) Reply(ctx, 200, "application/json; charset=utf-8", File.ReadAllBytes(file));
            else Reply(ctx, 204, "text/plain", new byte[0]);
            return;
        }
        // Corpo: nome sugerido do arquivo na primeira linha, HTML a imprimir no restante.
        if (route == "pdf" && post)
        {
            string text = Encoding.UTF8.GetString(body);
            int nl = text.IndexOf('\n');
            if (nl < 0) { Reply(ctx, 400, "text/plain", new byte[0]); return; }
            string target = ChoosePdf(text.Substring(0, nl));
            if (target == null) { Reply(ctx, 204, "text/plain", new byte[0]); return; }
            if (!PrintToPdf(text.Substring(nl + 1), target)) { Reply(ctx, 500, "text/plain", new byte[0]); return; }
            lastPdf = target;
            Reply(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"saved\":" + Json(target) + "}"));
            return;
        }
        // Abre apenas o último PDF gerado por este app.
        if (route == "open" && post)
        {
            if (lastPdf != null && File.Exists(lastPdf)) Process.Start(lastPdf);
            Reply(ctx, 200, "text/plain", new byte[0]);
            return;
        }
        Reply(ctx, 404, "text/plain", new byte[0]);
    }

    static string FindBrowser()
    {
        foreach (string exe in new string[] { "msedge.exe", "chrome.exe" })
        {
            foreach (RegistryKey root in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                try
                {
                    using (RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        string p = k == null ? null : k.GetValue(null) as string;
                        if (p != null && File.Exists(p)) return p;
                    }
                }
                catch { }
            }
        }
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetEnvironmentVariable("ProgramW6432") ?? pf86;
        foreach (string p in new string[] {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"), Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe") })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }
}

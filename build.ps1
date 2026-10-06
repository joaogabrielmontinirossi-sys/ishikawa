# Ishikawa: gera os ícones a partir de app\logo.svg, compila dist\Ishikawa.exe e monta dist\ishikawa.html (arquivo único).
# Usa apenas o que já vem no Windows: Edge (render do SVG), System.Drawing e o compilador C# do .NET Framework.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$app = Join-Path $root 'app'
$dist = Join-Path $root 'dist'
$icons = Join-Path $app 'icons'
New-Item -ItemType Directory -Force $dist, $icons | Out-Null
Add-Type -AssemblyName System.Drawing

# --- Ícones ---
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
function Render-Svg([string]$svg, [string]$out) {
    $html = Join-Path $env:TEMP 'ishikawa-render.html'
    "<!doctype html><html><body style='margin:0;background:transparent'><div style='width:512px;height:512px'>$svg</div></body></html>" | Out-File $html -Encoding utf8
    Start-Process $edge -Wait -ArgumentList '--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--window-size=512,512', "--user-data-dir=$env:TEMP\ishikawa-headless", "--screenshot=`"$out`"", "file:///$($html -replace '\\','/')"
}
function Resize-Png([string]$src, [int]$size, [string]$out) {
    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose(); $img.Dispose()
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
if ($edge) {
    $svg = Get-Content (Join-Path $app 'logo.svg') -Raw -Encoding UTF8
    Render-Svg $svg (Join-Path $icons 'icon-512.png')
    Render-Svg ($svg -replace 'rx="116"', 'rx="0"') (Join-Path $icons 'maskable-512.png')
    Resize-Png (Join-Path $icons 'icon-512.png') 192 (Join-Path $icons 'icon-192.png')
}
$ico = Join-Path $root 'desktop\ishikawa.ico'
$sizes = 16, 24, 32, 48, 64, 256
$pngs = foreach ($s in $sizes) { $p = Join-Path $env:TEMP "ishikawa-$s.png"; Resize-Png (Join-Path $icons 'icon-512.png') $s $p; , [System.IO.File]::ReadAllBytes($p) }
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $bw.Write([byte]($sizes[$i] % 256)); $bw.Write([byte]($sizes[$i] % 256)); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
[System.IO.File]::WriteAllBytes($ico, $ms.ToArray())

# --- Ishikawa.exe ---
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$res = Get-ChildItem $app -Recurse -File | ForEach-Object { "/resource:`"$($_.FullName)`",app/$($_.FullName.Substring($app.Length + 1) -replace '\\','/')" }
& $csc /nologo /target:winexe /optimize+ "/out:$dist\Ishikawa.exe" "/win32icon:$ico" /reference:System.Windows.Forms.dll $res (Join-Path $root 'desktop\Ishikawa.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar Ishikawa.exe' }

# --- Arquivo único (abre em qualquer navegador, inclusive no celular) ---
$read = { param($n) [System.IO.File]::ReadAllText((Join-Path $app $n), [System.Text.Encoding]::UTF8) }
$icon = 'data:image/png;base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $icons 'icon-192.png')))
$html = & $read 'index.html'
$html = $html.Replace('<link rel="manifest" href="manifest.webmanifest">', '').Replace('icons/icon-192.png', $icon)
$html = $html.Replace('<link rel="stylesheet" href="app.css">', "<style>`n" + (& $read 'app.css') + "</style>")
foreach ($js in 'store.js', 'diagram.js', 'app.js') {
    $html = $html.Replace("<script src=`"$js`"></script>", "<script>`n" + (& $read $js) + "</script>")
}
[System.IO.File]::WriteAllText((Join-Path $dist 'ishikawa.html'), $html, (New-Object System.Text.UTF8Encoding $false))

Get-ChildItem $dist | Select-Object Name, Length

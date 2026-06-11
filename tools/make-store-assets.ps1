# Generates Chrome Web Store assets into store-assets/.
# Run with: powershell -File tools\make-store-assets.ps1
Add-Type -AssemblyName System.Drawing

$slate = [System.Drawing.Color]::FromArgb(79, 93, 117)
$slateDark = [System.Drawing.Color]::FromArgb(56, 67, 87)
$gold  = [System.Drawing.Color]::FromArgb(201, 182, 135)
$paper = [System.Drawing.Color]::FromArgb(245, 243, 239)
$muted = [System.Drawing.Color]::FromArgb(176, 184, 199)
$blue  = [System.Drawing.Color]::FromArgb(126, 168, 212)
$red   = [System.Drawing.Color]::FromArgb(214, 126, 118)

$out = Join-Path (Split-Path $PSScriptRoot) "store-assets"
New-Item -ItemType Directory -Force $out | Out-Null

function Draw-MomentumLine($g, $w, $h, $zeroY, $lineWidth, $dotR) {
    $penZero = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 245, 243, 239), [Math]::Max(1, $lineWidth / 3))
    $g.DrawLine($penZero, [single]($w * 0.08), [single]$zeroY, [single]($w * 0.92), [single]$zeroY)

    $xs = 0.08, 0.20, 0.33, 0.46, 0.60, 0.74, 0.92
    $dy = 0.00, -0.10, 0.06, -0.04, 0.09, -0.08, 0.03
    $pts = @()
    for ($i = 0; $i -lt $xs.Count; $i++) {
        $pts += New-Object System.Drawing.PointF([single]($xs[$i] * $w), [single]($zeroY + $dy[$i] * $h))
    }
    $pen = New-Object System.Drawing.Pen($gold, $lineWidth)
    $pen.LineJoin = "Round"; $pen.StartCap = "Round"; $pen.EndCap = "Round"
    $g.DrawLines($pen, $pts)

    $g.FillEllipse((New-Object System.Drawing.SolidBrush($red)),  $pts[1].X - $dotR, $pts[1].Y - $dotR, 2 * $dotR, 2 * $dotR)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($blue)), $pts[4].X - $dotR, $pts[4].Y - $dotR, 2 * $dotR, 2 * $dotR)
}

function New-Tile($w, $h, $file, $titleSize, $tagSize, $lineWidth, $dotR) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"
    $g.TextRenderingHint = "AntiAliasGridFit"
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $slate, $slateDark, 90)
    $g.FillRectangle($bg, $bgRect)

    Draw-MomentumLine $g $w $h ($h * 0.76) $lineWidth $dotR

    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = "Center"
    $fTitle = New-Object System.Drawing.Font("Verdana", $titleSize, [System.Drawing.FontStyle]::Bold)
    $fTag = New-Object System.Drawing.Font("Verdana", $tagSize)
    $g.DrawString("Hindsight", $fTitle, (New-Object System.Drawing.SolidBrush($paper)),
        (New-Object System.Drawing.RectangleF(0, [single]($h * 0.14), $w, [single]($h * 0.35))), $fmt)
    $g.DrawString("Replay analysis for Pokemon Showdown", $fTag, (New-Object System.Drawing.SolidBrush($muted)),
        (New-Object System.Drawing.RectangleF(0, [single]($h * 0.14 + $titleSize * 2.1), $w, [single]($h * 0.25))), $fmt)

    $g.Dispose()
    $bmp.Save((Join-Path $out $file))
    $bmp.Dispose()
    Write-Host "wrote $file"
}

function New-StoreIcon {
    # 128 canvas, content inside a 96x96 safe zone per store guidelines
    $bmp = New-Object System.Drawing.Bitmap(128, 128)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x = 16; $y = 16; $w = 96; $h = 96; $d = 40
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $iconRect = New-Object System.Drawing.Rectangle(16, 16, 96, 96)
    $iconBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($iconRect, $slate, $slateDark, 90)
    $g.FillPath($iconBg, $path)

    $zeroY = 64
    $penZero = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 245, 243, 239), 2)
    $g.DrawLine($penZero, 26, $zeroY, 102, $zeroY)
    $xs = 26, 41, 56, 71, 86, 102
    $ys = 64, 46, 72, 52, 80, 42
    $pts = @()
    for ($i = 0; $i -lt $xs.Count; $i++) { $pts += New-Object System.Drawing.PointF($xs[$i], $ys[$i]) }
    $pen = New-Object System.Drawing.Pen($gold, 8)
    $pen.LineJoin = "Round"; $pen.StartCap = "Round"; $pen.EndCap = "Round"
    $g.DrawLines($pen, $pts)

    $g.Dispose()
    $bmp.Save((Join-Path $out "store-icon-128.png"))
    $bmp.Dispose()
    Write-Host "wrote store-icon-128.png"
}

New-Tile 440 280 "promo-small-440x280.png" 34 12 6 7
New-Tile 1400 560 "promo-marquee-1400x560.png" 80 26 13 15
New-StoreIcon

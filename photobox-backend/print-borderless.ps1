# ═══════════════════════════════════════════════════════════════
# Photobox Studio — Simple Borderless Photo Printer
# Uses default Windows printer, zero margins, fill-page
# ═══════════════════════════════════════════════════════════════
param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath,
    [int]$Copies = 1,
    [string]$PrinterName = ""
)

Add-Type -AssemblyName System.Drawing

try {
    if (-not (Test-Path $ImagePath)) {
        Write-Host "[PRINTER] ERROR: File not found: $ImagePath"
        exit 1
    }

    Write-Host "[PRINTER] Loading image: $ImagePath"
    $script:img = [System.Drawing.Image]::FromFile((Resolve-Path $ImagePath).Path)
    Write-Host "[PRINTER] Image size: $($script:img.Width)x$($script:img.Height) px"

    $pd = New-Object System.Drawing.Printing.PrintDocument

    # Use specific printer or default
    if ($PrinterName -and $PrinterName -ne "") {
        $pd.PrinterSettings.PrinterName = $PrinterName
    }
    Write-Host "[PRINTER] Using printer: $($pd.PrinterSettings.PrinterName)"

    if (-not $pd.PrinterSettings.IsValid) {
        Write-Host "[PRINTER] ERROR: Printer is not valid/available!"
        Write-Host "[PRINTER] Available printers:"
        foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
            Write-Host "  - $p"
        }
        exit 1
    }

    # Copies
    $pd.PrinterSettings.Copies = $Copies

    # Zero margins = borderless
    $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)

    # Auto orientation
    if ($script:img.Width -gt $script:img.Height) {
        $pd.DefaultPageSettings.Landscape = $true
    }

    # Print handler
    $pd.add_PrintPage({
        param($s, $ev)

        $pw = $ev.PageBounds.Width
        $ph = $ev.PageBounds.Height
        $iw = $script:img.Width
        $ih = $script:img.Height

        # Scale to fill (cover mode)
        $sx = $pw / $iw
        $sy = $ph / $ih
        $sc = [Math]::Max($sx, $sy)

        $dw = $iw * $sc
        $dh = $ih * $sc
        $dx = ($pw - $dw) / 2
        $dy = ($ph - $dh) / 2

        $ev.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $ev.Graphics.DrawImage($script:img, [float]$dx, [float]$dy, [float]$dw, [float]$dh)
        $ev.HasMorePages = $false
    })

    Write-Host "[PRINTER] Sending $Copies copy(s) to printer..."
    $pd.Print()
    Write-Host "[PRINTER] OK - Print job sent!"

    $script:img.Dispose()
    $pd.Dispose()
    exit 0
}
catch {
    Write-Host "[PRINTER] ERROR: $_"
    if ($script:img) { $script:img.Dispose() }
    exit 1
}

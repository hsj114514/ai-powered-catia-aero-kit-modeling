# SPDX-License-Identifier: GPL-3.0-only
param([string]$OutputFile)
$ErrorActionPreference = 'Stop'
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '1.2.0' -or $manifest.catiaAeroRevision -ne 'r11') { throw 'Expected package 1.2.0 / r11.' }
if (-not $OutputFile) { $OutputFile = Join-Path (Split-Path $packageRoot -Parent) 'catia-aero-kit-v1.2.0-r11-github.zip' }
$OutputFile = [System.IO.Path]::GetFullPath($OutputFile)
if ((Test-Path -LiteralPath $OutputFile) -or (Test-Path -LiteralPath ($OutputFile + '.sha256'))) { throw 'Output or checksum already exists. Choose a new output filename.' }
if (-not (Test-Path -LiteralPath (Split-Path $OutputFile -Parent) -PathType Container)) { throw 'Output directory does not exist.' }
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\','/')
$stage = [System.IO.Path]::GetFullPath((Join-Path $tempRoot ('catia-aero-package-' + [Guid]::NewGuid().ToString('N'))))
if ((Split-Path $stage -Parent) -ne $tempRoot) { throw 'Invalid staging directory.' }
try {
  $bundle = Join-Path $stage 'catia-aero-kit'
  New-Item -ItemType Directory -Path $bundle | Out-Null
  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $names = @('package.json') + @($manifest.files)
  foreach ($relative in $names) {
    if ($relative -eq 'checksums.sha256') { continue }
    if ($relative -isnot [string] -or $relative -match '[\x00-\x1f\\:*?]' -or $relative.StartsWith('/')) { throw 'Unsafe manifest path.' }
    $parts = $relative.Split('/')
    if ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }) { throw 'Unsafe manifest path components.' }
    if (-not $seen.Add($relative)) { throw ('Duplicate manifest entry: ' + $relative) }
    $source = [System.IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
    if (-not $source.StartsWith($packageRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest entry escapes root.' }
    $probe = $packageRoot
    foreach ($part in $parts) {
      $probe = Join-Path $probe $part
      $item = Get-Item -LiteralPath $probe -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Links are not supported.' }
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw ('Manifest entry is not a file: ' + $relative) }
    $destination = Join-Path $bundle $relative
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
  }
  $checksumLines = Get-ChildItem -LiteralPath $bundle -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($bundle.Length + 1).Replace('\','/')
    (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
  }
  [System.IO.File]::WriteAllText((Join-Path $bundle 'checksums.sha256'), (($checksumLines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open($OutputFile, 'Create')
  try {
    foreach ($item in (Get-ChildItem -LiteralPath $bundle -Recurse -File -Force | Sort-Object FullName)) {
      $relative = $item.FullName.Substring($bundle.Length + 1).Replace('\','/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, ('catia-aero-kit/' + $relative), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose() }
  $hash = (Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText(($OutputFile + '.sha256'), ($hash + '  ' + [System.IO.Path]::GetFileName($OutputFile) + "`n"), [System.Text.UTF8Encoding]::new($false))
  Write-Output $OutputFile
} finally {
  if (Test-Path -LiteralPath $stage) {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ($resolvedStage -ne $stage -or (Split-Path $resolvedStage -Parent) -ne $tempRoot -or -not ([System.IO.Path]::GetFileName($resolvedStage)).StartsWith('catia-aero-package-')) { throw 'Refusing unexpected cleanup target.' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

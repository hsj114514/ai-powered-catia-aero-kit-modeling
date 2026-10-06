# SPDX-License-Identifier: GPL-3.0-only
param([string]$OutputFile)
$ErrorActionPreference = 'Stop'
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '1.1.0') { throw 'This revision must retain the current package version.' }
if ($manifest.catiaAeroRevision -ne 'r6') { throw 'Expected revision r6.' }
if (-not $OutputFile) { $OutputFile = Join-Path (Split-Path $packageRoot -Parent) 'catia-aero-kit-v1.1-r6.zip' }
$OutputFile = [System.IO.Path]::GetFullPath($OutputFile)
if (Test-Path -LiteralPath $OutputFile) { throw 'Output already exists. Choose a new output filename.' }
if (-not (Test-Path -LiteralPath (Split-Path $OutputFile -Parent))) { throw 'Output directory does not exist.' }
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\','/')
$stage = [System.IO.Path]::GetFullPath((Join-Path $tempRoot ('catia-aero-package-' + [Guid]::NewGuid().ToString('N'))))
if ((Split-Path $stage -Parent) -ne $tempRoot) { throw 'Invalid staging directory.' }
try {
  $bundle = Join-Path $stage 'catia-aero-kit'
  New-Item -ItemType Directory -Path $bundle -Force | Out-Null
  foreach ($name in @('.gitignore','.gitattributes','package.json','index.js','cordis.patch.yml','icon.svg','LICENSE','README.md','README.en.md','CHANGELOG.md','RELEASE_NOTES.md','PORTABILITY.md','CONTRIBUTING.md','SECURITY.md','CHARTER.md','CODE_REVIEW.md','REVIEW_v1.1.0.md','VERIFICATION-real-vehicle.md','REVIEW_r6.md')) {
    Copy-Item -LiteralPath (Join-Path $packageRoot $name) -Destination (Join-Path $bundle $name)
  }
  $workflowDir = Join-Path $bundle '.github\workflows'
  New-Item -ItemType Directory -Path $workflowDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $packageRoot '.github\workflows\offline-checks.yml') -Destination $workflowDir
  $groups = @{ lib = @('*.js'); locale = @('*.json'); test = @('*.mjs'); scripts = @('*.ps1', '*.mjs') }
  foreach ($entry in $groups.GetEnumerator()) {
    $destination = Join-Path $bundle $entry.Key
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($pattern in $entry.Value) {
      Get-ChildItem -LiteralPath (Join-Path $packageRoot $entry.Key) -File -Filter $pattern | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destination
      }
    }
  }
  $checksumLines = Get-ChildItem -LiteralPath $bundle -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($bundle.Length + 1).Replace('\', '/')
    (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
  }
  [System.IO.File]::WriteAllLines((Join-Path $bundle 'checksums.sha256'), [string[]]$checksumLines, [System.Text.UTF8Encoding]::new($false))
  # Use portable '/' entry names and retain hidden files such as .gitignore.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open($OutputFile, 'Create')
  try {
    foreach ($item in (Get-ChildItem -LiteralPath $bundle -Recurse -File)) {
      $relative = $item.FullName.Substring($bundle.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $item.FullName, ('catia-aero-kit/' + $relative), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
  Write-Output $OutputFile
} finally {
  # Delete only this invocation's generated staging directory, after resolving and checking it.
  if (Test-Path -LiteralPath $stage) {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ($resolvedStage -ne $stage -or (Split-Path $resolvedStage -Parent) -ne $tempRoot) { throw 'Refusing unexpected cleanup target.' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

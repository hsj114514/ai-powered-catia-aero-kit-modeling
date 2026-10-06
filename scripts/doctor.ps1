# SPDX-License-Identifier: GPL-3.0-only
param([switch]$Json)
$ErrorActionPreference = 'Stop'
# Read-only environment discovery; does not install software, register COM or start CATIA.
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $nodePath) {
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }
  $nodePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
$nodeVersion = if ($nodePath) { & $nodePath --version } else { $null }
$scriptHost = if ($env:SystemRoot) { Join-Path $env:SystemRoot 'System32\cscript.exe' } else { $null }
$catiaRegistered = Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\CATIA.Application\CLSID'
$defaultRoot = $null
$rootError = $null
if ($nodePath -and $nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) {
  # Let the Node runtime choose paths exactly as the plugin does; no shell interpolation of paths.
  $discovery = & $nodePath (Join-Path $PSScriptRoot 'doctor.mjs') | ConvertFrom-Json
  $defaultRoot = $discovery.defaultProjectRoot
  $rootError = $discovery.projectRootError
} else {
  $rootError = 'Node.js 18+ is required to resolve the runtime project directory.'
}
$result = [ordered]@{
  NodePath = $nodePath
  NodeVersion = $nodeVersion
  NodeSupported = [bool]($nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18)
  ScriptHost = $scriptHost
  ScriptHostAvailable = [bool]($scriptHost -and (Test-Path -LiteralPath $scriptHost -PathType Leaf))
  CatiaComRegistered = $catiaRegistered
  DefaultProjectRoot = $defaultRoot
  ProjectRootError = $rootError
  Note = 'Registration is not a live CATIA verification. A DSH tools service is required to register the plugin; offline Node modules can run separately.'
}
if ($Json) { $result | ConvertTo-Json } else { [pscustomobject]$result | Format-List }

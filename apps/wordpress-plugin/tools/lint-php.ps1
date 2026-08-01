$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$phpFiles = Get-ChildItem -LiteralPath $pluginRoot -Recurse -Filter '*.php' -File
$php = Get-Command php -ErrorAction SilentlyContinue

if (-not $php) {
    throw 'PHP CLI is required to lint the WordPress plugin.'
}

foreach ($phpFile in $phpFiles) {
    & $php.Source -l $phpFile.FullName
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

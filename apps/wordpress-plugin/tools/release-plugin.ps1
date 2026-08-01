param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$Changes,

    [string]$Branch = "main",

    [string]$Repo = "MUST-DEV-TEAM/must-hotel-booking"
)

$ErrorActionPreference = "Stop"

function Fail($Message) {
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Info($Message) {
    Write-Host $Message -ForegroundColor Cyan
}

function Success($Message) {
    Write-Host $Message -ForegroundColor Green
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Fail "Version must look like 0.4.19"
}

$tag = "v$Version"
$pluginFile = "must-hotel-booking.php"
$readmeFile = "readme.txt"

if (!(Test-Path $pluginFile)) {
    Fail "Missing $pluginFile. Run this from the plugin repo root."
}

if (!(Test-Path $readmeFile)) {
    Fail "Missing $readmeFile. Run this from the plugin repo root."
}

git --version | Out-Null
gh --version | Out-Null

gh auth status | Out-Null

$currentBranch = git rev-parse --abbrev-ref HEAD

if ($currentBranch -ne $Branch) {
    Fail "You are on branch '$currentBranch'. Switch to '$Branch' before releasing."
}

Info "Pulling latest $Branch..."
git pull --ff-only origin $Branch

$pluginContent = Get-Content $pluginFile -Raw

$pluginContent = [regex]::Replace(
    $pluginContent,
    '(\*\s*Version:\s*)[0-9A-Za-z._-]+',
    {
        param($m)
        $m.Groups[1].Value + $Version
    },
    1
)

$pluginContent = [regex]::Replace(
    $pluginContent,
    "(\\define\('MUST_HOTEL_BOOKING_VERSION',\s*')[^']+('\);)",
    {
        param($m)
        $m.Groups[1].Value + $Version + $m.Groups[2].Value
    },
    1
)

Set-Content -Path $pluginFile -Value $pluginContent -NoNewline

$readmeContent = Get-Content $readmeFile -Raw

$readmeContent = [regex]::Replace(
    $readmeContent,
    '(?mi)^(Stable tag:\s*)[0-9A-Za-z._-]+',
    {
        param($m)
        $m.Groups[1].Value + $Version
    },
    1
)

# Remove accidental old broken changelog text if present.
$readmeContent = $readmeContent -replace "(?m)^3\. Commi\s*\r?\n", ""

if ($readmeContent -match "(?m)^= $([regex]::Escape($Version)) =") {
    Fail "Changelog already contains version $Version."
}

$changeItems = $Changes -split ';' | ForEach-Object {
    $_.Trim()
} | Where-Object {
    $_ -ne ''
}

if ($changeItems.Count -eq 0) {
    Fail "You must provide at least one changelog item. Separate multiple items with semicolons."
}

$changelogLines = @()
$changelogLines += "= $Version ="

foreach ($item in $changeItems) {
    if ($item.StartsWith("*")) {
        $changelogLines += $item
    } else {
        $changelogLines += "* $item"
    }
}

$changelogEntry = ($changelogLines -join "`r`n") + "`r`n`r`n"

$readmeContent = [regex]::Replace(
    $readmeContent,
    "(?m)(^== Changelog ==\s*\r?\n\r?\n)",
    {
        param($m)
        $m.Groups[1].Value + $changelogEntry
    },
    1
)

Set-Content -Path $readmeFile -Value $readmeContent -NoNewline

Info "Files updated."
git status --short

Write-Host ""
$confirm = Read-Host "Type RELEASE to commit, push, tag, and publish GitHub release"

$normalizedConfirm = [string]$confirm
$normalizedConfirm = $normalizedConfirm.Trim().ToUpperInvariant()

$acceptedConfirmations = @(
    "RELEASE",
    "RELESE",
    "REESE",
    "RELASE",
    "YES",
    "Y"
)

if ($acceptedConfirmations -notcontains $normalizedConfirm) {
    Fail "Release cancelled. Accepted confirmations: RELEASE, RELESE, REESE, YES, Y."
}
$releaseNotesFile = New-TemporaryFile

$releaseNotes = @()
$releaseNotes += "Release $tag"
$releaseNotes += ""
$releaseNotes += "Changes:"

foreach ($item in $changeItems) {
    $releaseNotes += "- $item"
}

Set-Content -Path $releaseNotesFile -Value ($releaseNotes -join "`r`n") -NoNewline

Info "Committing release..."
git add -A
git commit -m "Release $tag"

Info "Pushing commit..."
git push origin $Branch

Info "Creating local tag..."
git tag -a $tag -m $tag

Info "Pushing tag..."
git push origin $tag

Info "Publishing GitHub release..."
gh release create $tag `
    --repo $Repo `
    --target $Branch `
    --title $tag `
    --notes-file $releaseNotesFile `
    --latest

Remove-Item $releaseNotesFile -Force

Success "Release $tag published."
Success "GitHub Actions should now build and attach must-hotel-booking-$Version.zip automatically."
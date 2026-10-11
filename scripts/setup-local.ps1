# Download isolated Windows development dependencies; do not install system services.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $projectRoot '.data/tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$downloads = @(
  @{
    Name = 'livekit'
    Url = 'https://github.com/livekit/livekit/releases/download/v1.13.9/livekit_1.13.9_windows_amd64.zip'
    Hash = 'd5b5e44c197f613fdd6bdb2ae53e9d086d848156d43f614c688c6b595cd3f25e'
  },
  @{
    Name = 'storage'
    Url = 'https://github.com/seaweedfs/seaweedfs/releases/download/4.48/windows_amd64.zip'
    Hash = 'fe90c04c0620ad1a1c756f86cd5e1443773f56a446688077a4bb5ec04c3cc874'
  },
  @{
    Name = 'redis'
    Url = 'https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip'
    Hash = '7c8cebd50347eaa1d9e784da842ed47a4f33394637835531d6614777b950ee85'
  },
  @{
    Name = 'mailpit'
    Url = 'https://github.com/axllent/mailpit/releases/download/v1.31.4/mailpit-windows-amd64.zip'
    Hash = '0dd6ec909a6f5b2b66682b22d82abce97ab793e30766bf2f642b691e70a4a16b'
  }
)
foreach ($item in $downloads) {
  $archive = Join-Path $toolRoot ($item.Name + '.zip')
  if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $item.Url -OutFile $archive
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.Hash) {
    throw "Digest mismatch for $($item.Name); remove only the mismatched archive and retry."
  }
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolRoot $item.Name) -Force
  Write-Output "$($item.Name): verified and extracted."
}
Write-Output 'Ready. Run npm run local:start. This Redis Windows community build is for local development only.'

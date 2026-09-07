<#
.SYNOPSIS
  Fill one of the API's secrets without the value touching a shell history,
  a log, or a chat window.

.DESCRIPTION
  The secrets are defined by the CDK stack and created with placeholders;
  this is how a real value gets in. It prompts with a masked field, so the
  value is never an argument, and calls put-secret-value with whatever
  credentials and region the AWS CLI resolves. Each environment is its own
  account, so the secret ids carry no environment: which one you fill is
  which account you are signed in to. To reach an account other than your
  default's, set AWS_PROFILE (and AWS_REGION, if your configuration does not
  say) first. Run it from your own terminal.

.EXAMPLE
  $env:AWS_PROFILE = "dev"
  .\hosted\scripts\Set-RunlogSecret.ps1 -Secret workos/api-key
  .\hosted\scripts\Set-RunlogSecret.ps1 -Secret stripe/secret-key
#>
param(
  [Parameter(Mandatory)] [ValidateSet("workos/api-key", "stripe/secret-key", "stripe/webhook-secret", "stripe/connect-webhook-secret", "newrelic/license-key")] [string] $Secret,
  [string] $Value = $null
)

$id = "runlog/$Secret"
$aws = Get-Command aws -ErrorAction SilentlyContinue
if (-not $aws) { $aws = "$env:LOCALAPPDATA\Programs\Amazon\AWSCLIV2\aws.exe" } else { $aws = $aws.Source }

if ($null -eq $Value) {
  $secure = Read-Host -Prompt "Paste the value for $id" -AsSecureString
  $plain = [System.Net.NetworkCredential]::new("", $secure).Password
  if (-not $plain.Trim()) { Write-Error "nothing entered"; exit 1 }
} else {
  $plain = $Value
}

# As a JSON file the CLI reads, never as an argument: arguments show in
# process listings and transcripts. The file lives for one call.
# New Relic's extension reads its key out of a JSON object, so that one is
# wrapped; every other value goes in as it was pasted.
$value = $plain.Trim()
if ($Secret -eq "newrelic/license-key") { $value = @{ LicenseKey = $value } | ConvertTo-Json -Compress }
$payload = @{ SecretId = $id; SecretString = $value } | ConvertTo-Json -Compress
$tmp = New-TemporaryFile
try {
  Set-Content -Path $tmp -Value $payload -NoNewline -Encoding utf8
  $version = & $aws secretsmanager put-secret-value --cli-input-json "file://$($tmp.FullName)" --query VersionId --output text
  if ($LASTEXITCODE -eq 0) { "set $id (version $version)" } else { Write-Error "put-secret-value failed"; exit 1 }
} finally {
  $plain = $null
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  $payload = $null
}

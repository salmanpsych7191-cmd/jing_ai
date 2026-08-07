$json = '{"phone":"+919876543210","body":"Test reply from Restaurant AI"}'
Invoke-RestMethod -Uri 'https://tractor-mrs-poor-criterion.trycloudflare.com/api/diagnostics/twilio/test' -Method POST -Body $json -ContentType 'application/json' -TimeoutSec 15 | ConvertTo-Json -Depth 3

$form = @{
    From = 'whatsapp:+919876543210'
    Body = 'hello'
    NumMedia = '0'
}
try {
    $response = Invoke-RestMethod -Uri 'https://tractor-mrs-poor-criterion.trycloudflare.com/webhook/whatsapp' -Method POST -Body $form -TimeoutSec 15
    Write-Host "Response received:"
    Write-Host $response.OuterXml
} catch {
    Write-Host "Error: $_"
}

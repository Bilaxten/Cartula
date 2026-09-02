param(
    [string]$Title = "Agent",
    [string]$Message = "Yanıtın veya kararın gerekli olabilir."
)

# Yalnızca NORMAL Windows 10/11 toast bildirimi (Aksiyon Merkezi köşesinde sessizce
# belirir). Kullanıcı isteği: msg.exe'nin "Message from ..." kutusu bir virüs
# uyarısı gibi görünüyor — POPUP YOK. Toast bazen (kayıtlı AppUserModelID olmadan)
# istisna fırlatmadan sessizce görünmeyebilir (ölçüldü) — bu artık kabul edilen bir
# durum: kullanıcı "olmuyorsa boşver, popup olmasın" dedi. Başarısız olursa
# SESSİZCE yok sayılır, hiçbir fallback popup açılmaz.
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $safeTitle = [System.Security.SecurityElement]::Escape($Title)
    $safeMessage = [System.Security.SecurityElement]::Escape($Message)
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$safeTitle</text><text>$safeMessage</text></binding></visual></toast>")
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Title).Show($toast)
} catch {
    # Sessizce yok say — popup fallback YOK (kullanıcı isteği).
}

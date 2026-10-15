; Установщик Lampyris для Windows (Inno Setup 6). Собирается скриптом scripts\build-installer.ps1.
; Параметры передаёт скрипт: /DAppVersion=0.1.1 /DArch=x64|arm64 /DSourceDir=<пакет из build-windows.ps1> /DOutputDir=<dist>
#ifndef AppVersion
  #error Нужен параметр /DAppVersion
#endif
#ifndef Arch
  #error Нужен параметр /DArch (x64 или arm64)
#endif

[Setup]
AppId={{6B6F0A52-3E6C-4D58-9A2C-5C6B1F6A2D11}
AppName=Lampyris
AppVersion={#AppVersion}
AppPublisher=polons123
AppPublisherURL=https://github.com/polons123/lampyris
DefaultDirName={autopf}\Lampyris
DefaultGroupName=Lampyris
DisableProgramGroupPage=yes
; Установка для текущего пользователя без прав администратора; в диалоге можно выбрать установку для всех.
PrivilegesRequired=lowest
; commandline нужен автообновлению: оно запускает установщик с /CURRENTUSER или /ALLUSERS по режиму уже установленной копии.
PrivilegesRequiredOverridesAllowed=commandline dialog
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
LicenseFile={#SourceDir}\LICENSE
OutputDir={#OutputDir}
OutputBaseFilename=Lampyris-{#AppVersion}-windows-{#Arch}-setup
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\Lampyris.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
; Язык установщика выбирается по языку интерфейса Windows (русский или английский).
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
english.NoWebView2=WebView2 Runtime was not found: a Microsoft component without which Lampyris cannot show Lampa.%n%nSetup will continue. If the program offers to install WebView2 after that, download it from the Microsoft page: https://go.microsoft.com/fwlink/p/?LinkId=2124703
russian.NoWebView2=Не найден WebView2 Runtime — компонент Microsoft, без которого Lampyris не покажет Lampa.%n%nУстановка продолжится. Если после неё программа предложит установить WebView2, скачайте его на странице Microsoft: https://go.microsoft.com/fwlink/p/?LinkId=2124703

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\Lampyris.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\libmpv-2.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\THIRD-PARTY.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Lampyris"; Filename: "{app}\Lampyris.exe"
Name: "{autodesktop}\Lampyris"; Filename: "{app}\Lampyris.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Lampyris.exe"; Description: "{cm:LaunchProgram,Lampyris}"; Flags: nowait postinstall skipifsilent
; Автообновление запускает установщик тихо с /relaunch=1: после установки открываем программу снова (от имени пользователя, не администратора).
Filename: "{app}\Lampyris.exe"; Description: "{cm:LaunchProgram,Lampyris}"; Flags: nowait postinstall runasoriginaluser; Check: RelaunchRequested

; Настройки и журнал (%APPDATA%\Lampyris, %LOCALAPPDATA%\Lampyris) при удалении остаются: там адрес сервера и вход в Lampa.

[Code]
// WebView2 Runtime нужен для показа Lampa. В Windows 11 он есть, в старой Windows 10 может отсутствовать.
function WebView2Installed: Boolean;
var
  v: String;
begin
  Result := False;
  if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) then
    Result := (v <> '') and (v <> '0.0.0.0');
  if (not Result) and RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) then
    Result := (v <> '') and (v <> '0.0.0.0');
end;

function RelaunchRequested: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if (not WebView2Installed) and (not WizardSilent) then
    MsgBox(CustomMessage('NoWebView2'), mbInformation, MB_OK);
end;

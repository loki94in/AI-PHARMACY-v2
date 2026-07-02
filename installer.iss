; Inno Setup Configuration Script for AI Pharmacy OS Installer
; Requires Inno Setup compiler to run (http://www.jrsoftware.org/isinfo.php)

[Setup]
AppName=AI Pharmacy OS
AppVersion=0.1.0
AppPublisher=AI Pharmacy Team
DefaultDirName={autopf}\AI Pharmacy OS
DefaultGroupName=AI Pharmacy OS
OutputBaseFilename=AI-Pharmacy-OS-Setup
Compression=lzma2/max
SolidCompression=yes
; SetupIconFile=src\ui\logo.ico
UninstallDisplayIcon={app}\PharmacyOS.exe
PrivilegesRequired=admin
LicenseFile=license.txt

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Standalone compiled node binary output from pkg build
Source: "dist\PharmacyOS.exe"; DestDir: "{app}"; Flags: ignoreversion
; Environment configuration
Source: ".env.example"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdestfileexists
; Workspace documents and databases
Source: "data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "README.md"; DestDir: "{app}"; Flags: isreadme ignoreversion
Source: "license.txt"; DestDir: "{app}"; Flags: ignoreversion
; Portable Redis binaries
Source: "bin\redis\*"; DestDir: "{app}\bin\redis"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AI Pharmacy OS"; Filename: "{app}\PharmacyOS.exe"
Name: "{group}\{cm:UninstallProgram,AI Pharmacy OS}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\AI Pharmacy OS"; Filename: "{app}\PharmacyOS.exe"; Tasks: desktopicon

[Run]
; Install Redis service and configure firewall rules quietly (runhidden)
Filename: "{app}\bin\redis\redis-server.exe"; Parameters: "--service-install redis.windows.conf --service-name ""AIPharmacyRedis"" --port 16379"; StatusMsg: "Installing Redis database service..."; Flags: runhidden
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""AI Pharmacy Redis Server"" dir=in action=allow program=""{app}\bin\redis\redis-server.exe"" enable=yes profile=private"; StatusMsg: "Configuring Firewall exceptions..."; Flags: runhidden
; Launch application
Filename: "{app}\PharmacyOS.exe"; Description: "{cm:LaunchProgram,AI Pharmacy OS}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Stop and uninstall Redis Windows service quietly
Filename: "{app}\bin\redis\redis-server.exe"; Parameters: "--service-stop --service-name ""AIPharmacyRedis"""; Flags: runhidden
Filename: "{app}\bin\redis\redis-server.exe"; Parameters: "--service-uninstall --service-name ""AIPharmacyRedis"""; Flags: runhidden
; Remove firewall rules
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""AI Pharmacy Redis Server"""; Flags: runhidden

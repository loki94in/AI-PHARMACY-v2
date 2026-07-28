; ============================================================
;  AI Pharmacy OS — Inno Setup Installer Script
;  Version : 0.1.0
;  Compiler: Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;
;  BUILD STEPS (run from project root):
;    1.  npm run build:exe   (builds frontend, backend, bundles it, and
;                             packages dist\PharmacyOS.exe via Node SEA —
;                             see scripts/buildBundle.cjs and buildSea.cjs)
;    2.  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
;
;  PharmacyOS.exe is a Node SEA (Single Executable Application) build, not
;  a `pkg` build — pkg cannot run this codebase's dynamic import()-based
;  lazy routes/workers at all. SEA runs the real Node binary, but embeds
;  only our own bundled app code; it embeds none of node_modules, so the
;  full node_modules folder must ship alongside the exe (see [Files] below).
;
;  OUTPUT: dist\installer\AI-Pharmacy-OS-Setup-v0.1.0.exe
; ============================================================

#define MyAppName      "AI Pharmacy OS"
#define MyAppVersion   "0.1.0"
#define MyAppPublisher "AI Pharmacy Team"
#define MyAppURL       "https://github.com/loki94in/AI-PHARMACY-v2"
#define MyAppExeName   "PharmacyOS.exe"
#define MyAppPort      "5174"

[Setup]
AppId={{E3A1F2B4-7C8D-4E5F-9A0B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}

DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes

OutputDir=dist\installer
OutputBaseFilename=AI-Pharmacy-OS-Setup-v{#MyAppVersion}

Compression=lzma2/max
SolidCompression=yes

WizardStyle=modern
DisableWelcomePage=no
DisableProgramGroupPage=yes

PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
UsedUserAreasWarning=no

LicenseFile=license.txt
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Installer
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ============================================================
;  TASKS
; ============================================================
[Tasks]
Name: "desktopicon";  Description: "Create a &desktop shortcut";       GroupDescription: "Additional icons:"
Name: "startupentry"; Description: "Start server automatically on &Windows startup (1-2 min after boot)";  GroupDescription: "Startup:"

; ============================================================
;  FILES
; ============================================================
[Files]
; Main executable (nocompression — large single-binary Node SEA build, recompressing wastes RAM)
Source: "dist\PharmacyOS.exe"; DestDir: "{app}"; Flags: ignoreversion nocompression

; Built Web Frontend bundle
Source: "frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

; Full node_modules (Node SEA embeds only our own app code, not third-party
; packages — every dependency's real files must exist on disk beside the exe)
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Tesseract OCR data
Source: "eng.traineddata"; DestDir: "{app}"; Flags: ignoreversion

; Environment config
Source: ".env.example"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist

; Seed database (fresh install only — never overwrites user data on update)
Source: "data\app.db"; DestDir: "{app}\data"; Flags: onlyifdoesntexist

; Reference medicine CSV (large file — skip compression)
Source: "data\reference_medicines.csv"; DestDir: "{app}\data"; Flags: ignoreversion nocompression

; Documentation
Source: "INSTALL.md"; DestDir: "{app}"; Flags: isreadme ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "license.txt"; DestDir: "{app}"; Flags: ignoreversion

; Uploads folder placeholder
Source: "uploads\.gitkeep"; DestDir: "{app}\uploads"; Flags: ignoreversion

; Visual C++ 2015-2022 Redistributable (x64) — required by native addons
; (better-sqlite3, sqlite3, canvas, onnxruntime-node). Extracted to a temp
; folder and only run if not already present on the target PC (see [Run]/[Code]),
; so the installer works standalone on a completely clean Windows 10 PC.
Source: "vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

; ============================================================
;  SHORTCUTS
; ============================================================
[Icons]
Name: "{group}\{#MyAppName}";                       Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Open in Browser";                    Filename: "http://localhost:{#MyAppPort}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";                 Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

; ============================================================
;  REGISTRY — delayed Windows startup entry (60s delay after boot)
; ============================================================
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """cmd.exe"" /c timeout /t 60 /nobreak >nul && ""{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: startupentry

; ============================================================
;  RUN — post-install
; ============================================================
[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/quiet /norestart"; StatusMsg: "Installing Visual C++ Redistributable (required, one-time)..."; Check: VCRedistNeedsInstall; Flags: waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName} server"; Flags: nowait postinstall skipifsilent
Filename: "http://localhost:{#MyAppPort}"; Description: "Open in browser (http://localhost:{#MyAppPort})"; Flags: shellexec postinstall skipifsilent unchecked

; ============================================================
;  UNINSTALL RUN — kill server before removing files
; ============================================================
[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM {#MyAppExeName}"; Flags: runhidden; RunOnceId: "StopPharmacyServer"

; ============================================================
;  DIRS
; ============================================================
[Dirs]
Name: "{app}\data"
Name: "{app}\uploads"

; ============================================================
;  CODE
; ============================================================
[Code]

// ── VC++ Redistributable check ──────────────────────────────
// The official installer sets this registry value on a successful install.
// Skip re-running it if the target PC already has it (or a newer one).
function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  Result := not (RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Installed', Installed) and (Installed = 1));
end;

// ── Port check on install ──────────────────────────────────
function IsPortInUse(Port: Integer): Boolean;
var
  ResultCode: Integer;
begin
  Exec('cmd.exe',
    '/C netstat -ano | findstr :' + IntToStr(Port) + ' | findstr LISTENING > nul 2>&1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsPortInUse(5174) then begin
    if MsgBox(
      'Port 5174 is currently occupied.' + #13#10 +
      'AI Pharmacy OS needs port 5174 to run.' + #13#10#13#10 +
      'Continue installing anyway?',
      mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    Sleep(3000);
end;

// ── Force-delete a directory tree (handles non-empty dirs) ─
procedure ForceDeleteDir(Path: String);
var
  ResultCode: Integer;
begin
  if DirExists(Path) then
    Exec('cmd.exe', '/C rmdir /S /Q "' + Path + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ── Complete wipe on uninstall — no data left behind ──────
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir: String;
begin
  AppDir := ExpandConstant('{app}');

  if CurUninstallStep = usUninstall then
  begin
    // Kill any running server process first
    // (UninstallRun handles this but code path ensures it)
    ForceDeleteDir(AppDir + '\node_modules');
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    // Wipe database + WAL/SHM files
    ForceDeleteDir(AppDir + '\data');

    // Wipe all uploaded invoices and scans
    ForceDeleteDir(AppDir + '\uploads');

    // Remove .env config
    DeleteFile(AppDir + '\.env');

    // Nuke entire install folder — leaves absolutely nothing
    ForceDeleteDir(AppDir);
  end;
end;

[Setup]
AppName=X-FMOD Toolkit
AppVersion=1.0
AppPublisher=MACLine Dynamics
AppSupportURL=mailto:maclinedynamics@gmail.com
DefaultDirName={autopf}\X-FMOD Toolkit
DefaultGroupName=X-FMOD Toolkit
AllowNoIcons=yes
OutputDir=..\dist
OutputBaseFilename=X-FMOD-Toolkit-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The source path assumes the script is run from the 'installer' directory and the exe is in 'dist'
Source: "..\dist\X-FMOD Toolkit.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\X-FMOD.html"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\X-FMOD Toolkit"; Filename: "{app}\X-FMOD Toolkit.exe"
Name: "{group}\{cm:UninstallProgram,X-FMOD Toolkit}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\X-FMOD Toolkit"; Filename: "{app}\X-FMOD Toolkit.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\X-FMOD Toolkit.exe"; Description: "{cm:LaunchProgram,X-FMOD Toolkit}"; Flags: nowait postinstall skipifsilent

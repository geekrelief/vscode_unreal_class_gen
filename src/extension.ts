import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    // The ID must match the one in your package.json: "unrealClassCreatorPanel"
    const provider = new UnrealClassViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('unrealClassCreatorPanel', provider)
    );
}

interface CompileCommand {
    file: string;
    directory: string;
    command: string;
}

class UnrealClassViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    moduleName: string = "MYMODULE";
    defaultPath: string = "";

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'browse':
                    const folderUri = await vscode.window.showOpenDialog({
                        canSelectFolders: true,
                        canSelectFiles: false,
                        openLabel: 'Select Folder',
                        defaultUri: vscode.Uri.file(this.defaultPath)
                    });
                    if (folderUri && folderUri[0]) {
                        this.defaultPath = folderUri[0].fsPath.replaceAll('\\', '/');
                        webviewView.webview.postMessage({ 
                            command: 'setPath', 
                            value: this.defaultPath
                        });
                    }
                    break;

                case 'submitForm':
                    const { className, parentClassName, headerPath, cppPath, headerIncludePath } = message.data;
                    vscode.window.showInformationMessage(`Creating Unreal Class: ${className} ${parentClassName} at ${headerPath} and ${cppPath} with include path ${headerIncludePath}`);
                    console.log(`Creating Unreal Class: ${className} Parent Class: ${parentClassName} at ${headerPath} and ${cppPath} with include path ${headerIncludePath}`);

                    // Ensure directories exist
                    const headerDir = path.dirname(headerPath);
                    const cppDir = path.dirname(cppPath);
                    if (!fs.existsSync(headerDir)) fs.mkdirSync(headerDir, { recursive: true });
                    if (!fs.existsSync(cppDir)) fs.mkdirSync(cppDir, { recursive: true });

                    // 3. Generate File Content
                    if (fs.existsSync(headerPath) || fs.existsSync(cppPath)) {
                        vscode.window.showErrorMessage(`Error: One or both files already exist. Aborting creation.`);
                        return;
                    }

                    const headerContent = this.generateHeader(className, parentClassName);
                    const cppContent = this.generateCpp(headerIncludePath);

                    // Write files
                    fs.writeFileSync(headerPath, headerContent);
                    fs.writeFileSync(cppPath, cppContent);

                    if (fs.existsSync(headerPath)) {
                        this.openFileInEditor(headerPath);
                    }
                    if (fs.existsSync(cppPath)) {
                        this.openFileInEditor(cppPath);
                    }

                    this.updateCompileCommandsJson(headerPath);
                    this.updateCompileCommandsJson(cppPath);

                    // Update Intellisense (c_cpp_properties.json)
                    //await updateIntellisense(headerDir);
                    break;
                case 'webviewReady':
                    this.initalizeDefaultPath(webviewView);
                    break;
            }
        });
    }

    private getRootPath(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri.fsPath;
        }
        return "";
    }

    private async initalizeDefaultPath(webviewView: vscode.WebviewView) {
        // Get the current workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.defaultPath = this.getRootPath();
            try {
                // 1. Get all files in root to find .uproject
                const files = await fs.promises.readdir(this.defaultPath);
                const uprojectFile = files.find(f => f.endsWith('.uproject'));

                if (uprojectFile) {
                    this.moduleName = path.basename(uprojectFile, '.uproject');
                    // 2. Construct the path to Source/ProjectName
                    this.defaultPath = path.join(this.defaultPath, 'Source', this.moduleName, '').replaceAll('\\', '/');
                    this.defaultPath = (this.defaultPath + '/').replace(/\/+/g, '/');

                    // 3. Verify the Source subfolder exists
                    if (!fs.existsSync(this.defaultPath)) {
                        console.error("Could not find Source subfolder", this.defaultPath);
                    }
                }
                else
                {
                    console.error("Could not find uproject in workspace", this.defaultPath);
                }
            } catch (err) {
                console.error("Error searching workspace:", err);
            }

            webviewView.webview.postMessage({ command: 'initializeDefaultPath', value: this.defaultPath });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { padding: 10px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
        .input-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; }
        button { cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 12px; width: 100%; margin-top: 10px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .row { display: flex; gap: 5px; }
        #browseBtn { width: auto; margin-top: 0; }
    </style>
</head>
<body>
    <div class="input-group">
        <label>Class Type</label>
        <select id="classType">
            <option value="root">Root</option>
            <option value="public" selected>Public</option>
            <option value="private">Private</option>
        </select>
    </div>

    <div class="input-group">
        <label>Class Name</label>
        <input type="text" id="className" placeholder="e.g. MyClass">
    </div>

    <div class="input-group">
        <label>Parent Class</label>
        <input type="text" id="parentClassName" placeholder="e.g. UObject">
    </div>

    <div class="input-group">
        <label>Storage Location</label>
        <div class="row">
            <input type="text" id="pathInput" placeholder="Select folder...">
            <button id="browseBtn">Browse</button>
        </div>
    </div>

    <div class="input-group">
        <label>Preview</label>
        <div style="font-size: 0.8em; opacity: 0.8;">
            Header: <span id="headerLocation">...</span><br>
            Source: <span id="cppLocation">...</span>
        </div>
    </div>

    <button id="createBtn">Create Unreal Class</button>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        const pathInput = document.getElementById('pathInput');
        const classNameInput = document.getElementById('className');
        const classType = document.getElementById('classType');
        const headerLocation = document.getElementById('headerLocation');
        const cppLocation = document.getElementById('cppLocation');

        var defaultPath = "";
        document.getElementById('browseBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'browse' });
        });

        document.getElementById('createBtn').addEventListener('click', () => {
            const className = document.getElementById('className').value || "MyClass";
            const parentClassName = document.getElementById('parentClassName').value || "UObject";
            const headerPath = headerLocation.textContent;
            const cppPath = cppLocation.textContent;
            const headerIncludePath = headerPath.split(defaultPath)[1].replace("Public/", "");
            vscode.postMessage({
                command: 'submitForm',
                data: { className, parentClassName, headerPath, cppPath, headerIncludePath }
            });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'setPath') {
                document.getElementById('pathInput').value = message.value;
                updatePreviews();
            }
            else if (message.command === 'initializeDefaultPath') {
                document.getElementById('pathInput').value = message.value;
                defaultPath = message.value;
                updatePreviews();
            }
        });

        function updatePreviews() {
            const base = pathInput.value || defaultPath;
            const name = classNameInput.value || "MyClass";

            if (base === defaultPath || (base + '/') === defaultPath || base.startsWith(defaultPath +"Public/") || base.startsWith(defaultPath + "Public")){
                classType.value = "public";
            } else if (base.startsWith(defaultPath + "Private/") || base.startsWith(defaultPath + "Private")){
                classType.value = "private";
            } else {
                classType.value = "root";
            }

            if (classType.value === 'public') {
                var headerPath = '';
                var cppPath = '';
                if (base.toLowerCase().includes("/public/") || base.toLowerCase().endsWith("/public")) {
                    headerPath = (base + "/" + name + ".h").replaceAll('//','/');
                    cppPath = (base.replace(/public/i, "Private") + "/" + name + ".cpp").replaceAll('//','/');
                } else {
                    headerPath = (base + "/Public/" + name + ".h").replaceAll('//','/');
                    cppPath = (base + "/Private/" + name + ".cpp").replaceAll('//','/');
                }

                headerLocation.textContent = headerPath;
                cppLocation.textContent = cppPath;
            }
            else if (classType.value === 'private') {
                var headerPath = '';
                var cppPath = '';
                if (base.toLowerCase().includes("/private/") || base.toLowerCase().endsWith("/private")) {
                    headerPath = (base + "/" + name + ".h").replaceAll('//','/');
                    cppPath = (base + "/" + name + ".cpp").replaceAll('//','/');
                } else {
                    headerPath = (base + "/Private/" + name + ".h").replaceAll('//','/');
                    cppPath = (base + "/Private/" + name + ".cpp").replaceAll('//','/');
                }

                headerLocation.textContent = headerPath;
                cppLocation.textContent = cppPath;
            }
            else {
                headerLocation.textContent = base + "/" + name + ".h";
                cppLocation.textContent = base + "/" + name + ".cpp";
            }
        }

        function updateClassType(){
            const base = pathInput.value;
            var ending = base.split(defaultPath)[1] || "";
            ending = ending.replace("Public/", "").replace("Private/", "");

            if (classType.value === 'public') {
                pathInput.value = (defaultPath + "/Public/" + ending).replaceAll("//", '/');
            }
            else if (classType.value === 'private') {
                pathInput.value = (defaultPath + "/Private/" + ending).replaceAll("//", '/');
            }

            updatePreviews();
        }

        // Listen for any changes
        [pathInput, classNameInput].forEach(el => {
            el.addEventListener('input', updatePreviews);
        });

        classType.addEventListener('input', updateClassType);

        vscode.postMessage({ command: 'webviewReady' });
    </script>
</body>
</html>`;
    }

    private generateHeader(className: string, parentClassName: string, copyright: string = "Copyright notice"): string {
        // Basic include mapping for common classes
        const includeMap: { [key: string]: string } = {
            'UObject': 'CoreMinimal.h',
            'AActor': 'GameFramework/Actor.h',
            'APawn': 'GameFramework/Pawn.h',
            'ACharacter': 'GameFramework/Character.h',
            'APlayerController': 'GameFramework/PlayerController.h',
            'AGameMode': 'GameFramework/GameMode.h',
            'AGameModeBase': 'GameFramework/GameModeBase.h',
            'AGameState': 'GameFramework/GameState.h',
            'UGameInstance': 'Engine/GameInstance.h',
            'UUserWidget': 'Blueprint/UserWidget.h',
            'UActorComponent': 'Components/ActorComponent.h',
            'USceneComponent': 'Components/SceneComponent.h',
            'UStaticMeshComponent': 'Components/StaticMeshComponent.h',
            'USkeletalMeshComponent': 'Components/SkeletalMeshComponent.h',
            'AGameStateBase': 'GameFramework/GameStateBase.h',
            'APlayerState': 'GameFramework/PlayerState.h',
            'UCharacterMovementComponent': 'GameFramework/CharacterMovementComponent.h',
            'UInterface': 'UObject/Interface.h',
            'UDataAsset': 'Engine/DataAsset.h',
            'UPrimaryDataAsset': 'Engine/DataAsset.h',
            'UDataTable': 'Engine/DataTable.h',
            'UCurveTable': 'Engine/CurveTable.h',
            'USoundBase': 'Sound/SoundBase.h',
            'UTexture2D': 'Engine/Texture2D.h',
            'UCameraComponent': 'Camera/CameraComponent.h',
            'USpringArmComponent': 'GameFramework/SpringArmComponent.h',
            'UBoxComponent': 'Components/BoxComponent.h',
            'USphereComponent': 'Components/SphereComponent.h',
            'UCapsuleComponent': 'Components/CapsuleComponent.h',
            'AAIController': 'AIController.h',
            'UBehaviorTree': 'BehaviorTree/BehaviorTree.h',
            'UBlackboardData': 'BehaviorTree/BlackboardData.h',
            'UAnimInstance': 'Animation/AnimInstance.h',
            'UWorld': 'Engine/World.h',
            'USubsystem': 'Subsystems/Subsystem.h',
            'UGameInstanceSubsystem': 'Subsystems/GameInstanceSubsystem.h',
            'UWorldSubsystem': 'Subsystems/WorldSubsystem.h',
            'ULocalPlayerSubsystem': 'Subsystems/LocalPlayerSubsystem.h',
            'UInputComponent': 'Components/InputComponent.h',
            'UEnhancedInputComponent': 'EnhancedInputComponent.h'
        };
        
        const includeFile = includeMap[parentClassName] || `CoreMinimal.h`; // Fallback to CoreMinimal
        const prefixedClassName = parentClassName[0] + className;
        const moduleAPI = this.moduleName.toUpperCase() + '_API';

        return `// ${copyright}

#pragma once

#include "${includeFile}"
#include "${className}.generated.h"

/**
*
*/
UCLASS()
class ${moduleAPI} ${prefixedClassName} : public ${parentClassName}
{
    GENERATED_BODY()

};
`;
    }

    private generateCpp(headerIncludePath: string, copyright:string = "Copyright notice"): string {
        return `// ${copyright}

#include "${headerIncludePath}"`;
    }

    private async openFileInEditor(filePath: string) {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
            preview: false, // Set to false to keep the tab open
            viewColumn: vscode.ViewColumn.Active // Open in the current group
        });
    }

    private async updateCompileCommandsJson(filePath: string) {
        // This is for Intellisense to recognize the new files

        //console.log(`Updating compile commands JSON for new file: ${filePath}`);
        // Sample from .vscode/compileCommands json
        // {
        //     "file": "D:\\unreal-projects\\_UDEMY\\FRUI\\Source\\FRUI\\Public\\Widgets\\Widget_PrimaryLayout.h",
        //     "arguments": [
        //         "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe",
        //         "@D:\\unreal-projects\\_UDEMY\\FRUI\\.vscode\\compileCommands_FRUI\\FRUI.1.rsp"
        //     ],
        //     "directory": "D:\\Epic Games\\UE_5.7\\Engine\\Source"
        // }

        const ccDefaultTxt = fs.readFileSync(path.join(this.getRootPath(), '.vscode', 'compileCommands_Default.json'), 'utf-8');
        var ccDefaultJson: CompileCommand[] = JSON.parse(ccDefaultTxt);
        const ccDefaultEntryExists = ccDefaultJson.some(item => item.file.replaceAll('\\', '/') === filePath);
        if (!ccDefaultEntryExists) {
            var newDefaultEntry = structuredClone(ccDefaultJson[0]);
            newDefaultEntry.file = filePath.replaceAll('/', '\\');
            ccDefaultJson.push(newDefaultEntry);
            fs.writeFileSync(path.join(this.getRootPath(), '.vscode', 'compileCommands_Default.json'), JSON.stringify(ccDefaultJson, null, '\t'), 'utf-8');
            //console.log(`Added entry for ${filePath} to compileCommands_Default.json`);
        }
        // else {
        //     console.log("Entry already exists in compileCommands_Default.json");
        // }

        const ccModule = fs.readFileSync(path.join(this.getRootPath(), '.vscode', `compileCommands_${this.moduleName}.json`), 'utf-8');
        var ccModuleJson: CompileCommand[] = JSON.parse(ccModule);
        const ccModuleEntryExists = ccModuleJson.some(item => item.file.replaceAll('\\', '/') === filePath);
        if (!ccModuleEntryExists) {
            var newModuleEntry = structuredClone(ccModuleJson[0]);
            newModuleEntry.file = filePath.replaceAll('/', '\\');
            ccModuleJson.push(newModuleEntry);
            fs.writeFileSync(path.join(this.getRootPath(), '.vscode', `compileCommands_${this.moduleName}.json`), JSON.stringify(ccModuleJson, null, '\t'), 'utf-8');
            //console.log(`Added entry for ${filePath} to compileCommands_${this.moduleName}.json`);
        } 
        // else {
        //     console.log(`Entry already exists in compileCommands_${this.moduleName}.json`);
        // }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
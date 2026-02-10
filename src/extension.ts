import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {spawn} from 'child_process';

const extensionID:string = "unrealClassCreator";

export function activate(context: vscode.ExtensionContext) {
    // The ID must match the one in your package.json: "unrealClassCreatorPanel"
    const provider = new UnrealClassViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('unrealClassCreatorPanel', provider)
    );

}

type ProjectType = "vscode" | "vs2026";

const UnrealBuildToolProjectTypeArg: Record<ProjectType, string> = {
    "vscode":"-VSCode",
    "vs2026":"-ProjectFileFormat=VisualStudio2026"
};

interface CompileCommand {
    file: string;
    directory: string;
    command: string;
}

class UnrealClassViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    moduleName: string = "MYMODULE";
    rootSourcePath: string = "";

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
                case 'browseFilePath':
                    const folderUri = await vscode.window.showOpenDialog({
                        canSelectFolders: true,
                        canSelectFiles: false,
                        openLabel: 'Select Folder',
                        defaultUri: vscode.Uri.file(this.rootSourcePath)
                    });
                    if (folderUri && folderUri[0]) {
                        this.rootSourcePath = folderUri[0].fsPath.replaceAll('\\', '/');
                        webviewView.webview.postMessage({ 
                            command: 'setPath', 
                            value: this.rootSourcePath
                        });
                    }
                    break;

                case 'createFiles':
                    const { className, parentClassName, headerPath, cppPath, headerIncludePath, isHeaderOnly } = message.data;

                    const headerDir = path.dirname(headerPath);
                    if (!fs.existsSync(headerDir)) fs.mkdirSync(headerDir, { recursive: true });
                    if (fs.existsSync(headerPath)) {
                        vscode.window.showErrorMessage(`Error: header file already exists at ${headerPath}. Aborting creation.`);
                        return;
                    }

                    const headerContent = this.generateHeader(className, parentClassName);

                    fs.writeFileSync(headerPath, headerContent);
                    this.updateCompileCommandsJson(headerPath);

                    if (fs.existsSync(headerPath)) {
                        this.openFileInEditor(headerPath);
                    }

                    if (!isHeaderOnly) { // generate the cpp file
                        const cppDir = path.dirname(cppPath);
                        if (!fs.existsSync(cppDir)) fs.mkdirSync(cppDir, { recursive: true });
                        if (fs.existsSync(cppPath)) {
                            vscode.window.showErrorMessage(`Error: cpp file already exists at ${cppPath}. Aborting creation.`);
                            return;
                        }

                        const cppContent = this.generateCpp(headerIncludePath);
                        fs.writeFileSync(cppPath, cppContent);
                        this.updateCompileCommandsJson(cppPath);

                        if (fs.existsSync(cppPath)) {
                            this.openFileInEditor(cppPath);
                        }
                    }

                    if (!isHeaderOnly) {
                        vscode.window.showInformationMessage(`Creating Unreal Class: ${className} ${parentClassName} at ${headerPath} and ${cppPath} with include path ${headerIncludePath}`);
                        console.log(`Creating Unreal Class: ${className} Parent Class: ${parentClassName} at ${headerPath} and ${cppPath} with include path ${headerIncludePath}`);
                    } else {
                        vscode.window.showInformationMessage(`Creating Unreal Header: ${className} ${parentClassName} at ${headerPath} (Header Only) with include path ${headerIncludePath}`);
                        console.log(`Creating Unreal Header: ${className} Parent Class: ${parentClassName} at ${headerPath} (Header Only) with include path ${headerIncludePath}`);
                    }
                    break;

                case 'browseEnginePath':
                    this.browseEnginePath(webviewView);
                    break;

                case 'updateProjectType':
                    vscode.workspace.getConfiguration(extensionID).update('projectType', message.data);
                    break;

                case 'generateProject':
                    this.generateProject(webviewView);
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
            return workspaceFolders[0].uri.fsPath.replaceAll('\\', '/')
        }
        return "";
    }

    private async findProjectFilePath(): Promise<string | undefined> {
        try{ 
            const files = await fs.promises.readdir(this.getRootPath());
            const uprojectFilename = files.find(f => f.endsWith('.uproject'));
            if (uprojectFilename){
                return path.join(this.getRootPath(), uprojectFilename);
            }
            else
            {
                vscode.window.showErrorMessage(`Could not find .uproject in ${this.getRootPath()}`);
            }
        } catch(error) {
            vscode.window.showErrorMessage(`An error occured while try to find .uproject in ${this.getRootPath()}: ${error}`);
            return undefined;
        }
    }

    private async initalizeDefaultPath(webviewView: vscode.WebviewView) {
        // Get the current workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.rootSourcePath = this.getRootPath();
            try {
                // 1. Get all files in root to find .uproject
                const uprojectFile = await this.findProjectFilePath();

                if (uprojectFile) {

                    this.moduleName = path.basename(uprojectFile, '.uproject');
                    // 2. Construct the path to Source/ProjectName
                    this.rootSourcePath = path.join(this.rootSourcePath, 'Source', this.moduleName, '').replaceAll('\\', '/');
                    this.rootSourcePath = (this.rootSourcePath + '/').replace(/\/+/g, '/');

                    // 3. Verify the Source subfolder exists
                    if (!fs.existsSync(this.rootSourcePath)) {
                        console.error("Could not find Source subfolder", this.rootSourcePath);
                        vscode.window.showErrorMessage(`Could not find Source subfolder ${this.rootSourcePath}`);
                    }
                }
                else
                {
                    console.error("Could not find uproject in workspace", this.rootSourcePath);
                    vscode.window.showErrorMessage(`Could not find uproject in workspace ${this.rootSourcePath}`);
                }
            } catch (err) {
                console.error("Error searching workspace:", err);
                vscode.window.showErrorMessage(`Error searching workspace: ${err}`);
            }

            webviewView.webview.postMessage({ command: 'initializeDefaultPath', value: this.rootSourcePath });
        }

        let config = vscode.workspace.getConfiguration(extensionID)

        const projectType: string = config.get<string>('projectType', '');
        webviewView.webview.postMessage({command: 'initializeProjectType', value: projectType });

        var enginePath: string = config.get<string>('enginePath', '');
        webviewView.webview.postMessage({command: 'initializeEnginePath', value: enginePath });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.4; }
        .input-group { margin-bottom: 12px; }
        label { display: block; margin-bottom: 5px; font-weight: normal; color: var(--vscode-input-foreground); opacity: 0.9;}

        input { 
            width: 100%; 
            box-sizing: border-box; 
            background: var(--vscode-input-background); 
            color: var(--vscode-input-foreground); 
            border: 1px solid var(--vscode-input-border, transparent); 
            padding: 4px 6px; 
            outline-offset: -1px;
        }

        /* Native-style focus border */
        .form-section {
            margin-top: 25px; 
            padding: 10px; 
            border: 1px solid #cccccc1f;
            border-radius: 4px;
        }

        input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }

        input::selection { background-color: var(--vscode-selection-background) !important; }
        button { cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; width: 100%; margin-top: 10px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .row { display: flex; gap: 4px; }
        #browseFilePathBtn, #browseEnginePathBtn { width: auto; margin-top: 0; }
        #enginePath { flex: 1; }
        .gen-button { 
            border: 1px solid var(--vscode-button-border, #cccccc1f);
        }
        .footer-row {
            display: flex;
            align-items: center; /* Vertically centers the checkbox with the button */
            gap: 12px;           /* Adds space between the checkbox and the button */
            margin-top: 10px;
            overflow: hidden;
        }

        .checkbox-container {
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            white-space: nowrap;
            flex-shrink: 0;
        }

        .checkbox-container input {
            margin-right: 6px;   /* Space between the actual box and the label text */
            cursor: pointer;
        }

        .strikethrough {
            text-decoration: line-through;
            opacity: 0.5; /* Optional: dims the text slightly for a better visual "disabled" look */
        }
    </style>
</head>
<body>
    <div class="form-section">
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
                <button id="browseFilePathBtn">Browse</button>
            </div>
        </div>

        <div class="input-group">
            <label>Preview</label>
            <div style="font-size: 0.8em; opacity: 0.8;">
                Header: <span id="headerLocation">...</span><br>
                Source: <span id="cppLocation">...</span>
            </div>
        </div>

        <div class="footer-row">
            <label class="checkbox-container">
                <input type="checkbox" id="headerOnly" />
                <span>Header Only</span>
            </label>
            <button class="gen-button" id="createFilesBtn">Create Unreal Class</button>
        </div>
    </div>

    <div class="form-section">
        <div class="input-group">
            <label>Engine Location</label>
            <div class="row">
                <div id="enginePath">Please select the Unreal Engine folder...</div>
                <button id="browseEnginePathBtn">Browse</button>
            </div>
        </div>

        <div class="input-group">
            <label>IDE</label>
            <select id="projectType">
                <option value="vscode">VSCode</option>
                <option value="vs2026">VisualStudio 2026</option>
            </select>
        </div>

        <div class="footer-row">
            <button class="gen-button" id="generateProjectBtn">Generate Unreal Project</button>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        const pathInput = document.getElementById('pathInput');
        const classNameInput = document.getElementById('className');
        const classType = document.getElementById('classType');
        const headerLocation = document.getElementById('headerLocation');
        const cppLocation = document.getElementById('cppLocation');
        const headerOnlyCheckbox = document.getElementById('headerOnly');
        const enginePath = document.getElementById('enginePath');
        const projectType = document.getElementById('projectType');

        var rootSourcePath = "";
        document.getElementById('browseFilePathBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'browseFilePath' });
        });

        headerOnlyCheckbox.addEventListener('change', () => {
            if (headerOnlyCheckbox.checked) {
                cppLocation.classList.add('strikethrough');
            } else {
                cppLocation.classList.remove('strikethrough');
            }
        });

        document.getElementById('createFilesBtn').addEventListener('click', () => {
            const className = document.getElementById('className').value || "MyClass";
            const parentClassName = document.getElementById('parentClassName').value;
            const headerPath = headerLocation.textContent;
            const cppPath = cppLocation.textContent;
            const headerIncludePath = headerPath.split(rootSourcePath)[1].replace("Public/", "");
            const isHeaderOnly = headerOnlyCheckbox.checked;
            vscode.postMessage({
                command: 'createFiles',
                data: { className, parentClassName, headerPath, cppPath, headerIncludePath, isHeaderOnly }
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
                rootSourcePath = message.value;
                updatePreviews();
            }
            else if (message.command === 'setEnginePath' || message.command === 'initializeEnginePath') {
                enginePath.textContent = message.value;
            }
            else if (message.command === 'initializeProjectType') {
                projectType.value = message.value;
            }
        });

        function updatePreviews() {
            const base = pathInput.value || rootSourcePath;
            const name = classNameInput.value || "MyClass";

            if (base === rootSourcePath || (base + '/') === rootSourcePath || base.startsWith(rootSourcePath +"Public/") || base.startsWith(rootSourcePath + "Public")){
                classType.value = "public";
            } else if (base.startsWith(rootSourcePath + "Private/") || base.startsWith(rootSourcePath + "Private")){
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
            var ending = base.split(rootSourcePath)[1] || "";
            ending = ending.replace("Public/", "").replace("Private/", "");

            if (classType.value === 'public') {
                pathInput.value = (rootSourcePath + "/Public/" + ending).replaceAll("//", '/');
            }
            else if (classType.value === 'private') {
                pathInput.value = (rootSourcePath + "/Private/" + ending).replaceAll("//", '/');
            }

            updatePreviews();
        }

        // Listen for any changes
        [pathInput, classNameInput].forEach(el => {
            el.addEventListener('input', updatePreviews);
        });

        classType.addEventListener('input', updateClassType);

        document.getElementById('browseEnginePathBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'browseEnginePath' });
        });

        projectType.addEventListener('input', () => {
            vscode.postMessage({ command: 'updateProjectType', data: projectType.value });
        });

        document.getElementById('generateProjectBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'generateProject' });
        });

        vscode.postMessage({ command: 'webviewReady' });
    </script>
</body>
</html>`;
    }

    private async browseEnginePath(webviewView: vscode.WebviewView) {
        let config = vscode.workspace.getConfiguration(extensionID)
        var enginePath: string = config.get<string>('enginePath', '');
        const engineFolderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            openLabel: 'Select Unreal Engine Folder',
            defaultUri: vscode.Uri.file(enginePath)
        });

        if (engineFolderUri && engineFolderUri[0]) {
            enginePath = engineFolderUri[0].fsPath.replaceAll('\\', '/');
            if (path.basename(enginePath) === "Engine") // just get the root of the engine dir, if the user stepped inside it.
            {
                enginePath = path.dirname(enginePath)
            }
            const buildToolPath = enginePath + '/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe'
            if (fs.existsSync(buildToolPath))
            {
                config.update('enginePath', enginePath);
                webviewView.webview.postMessage({ 
                    command: 'setEnginePath', 
                    value: enginePath
                });
            }
            else
            {
                vscode.window.showErrorMessage(`Could not find Unreal Engine Build Tool:  ${buildToolPath}`);
            }
        }
    }

    private async generateProject(webviewView: vscode.WebviewView) {
        let config = vscode.workspace.getConfiguration(extensionID);
        let projectPath: string | undefined = await this.findProjectFilePath();
        let enginePath: string = config.get<string>('enginePath', '');
        let projectType: ProjectType = config.get<string>('projectType', '') as ProjectType;
        let projectArgs: string = UnrealBuildToolProjectTypeArg[projectType];

        if (!projectPath)
        {
            vscode.window.showErrorMessage(`generateProject: Could not find the uproject here ${projectPath}`);
            return;
        }

        if (!projectType)
        {
            console.error(`Please select a project type: ${projectType}`);
            return;
        }

        const buildToolPath = (enginePath + '/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe').replace(/\/+/g, '/');
        const buildCommand = `& '${buildToolPath}' -Project='${projectPath}' ${projectArgs} -game -rocket`;

        const terminal = vscode.window.createTerminal("Generating Unreal Project");
        terminal.show();
        terminal.sendText(buildCommand);
    }

    private getCopyrightSetting(): string {
        // 1. Get the configuration object using your prefix
        const config = vscode.workspace.getConfiguration(extensionID);

        // 2. Get the specific property. 
        // The second argument is a fallback if the setting is missing.
        const copyright = config.get<string>('copyrightText', '');

        // 3. (Optional) Replace dynamic variables like ${year}
        const currentYear = new Date().getFullYear().toString();
        return copyright.replace('${year}', currentYear);
    }

    private generateHeader(className: string, parentClassName: string): string {
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
        const prefixedClassName = parentClassName.length > 0 ? parentClassName[0] + className : '';
        const moduleAPI = this.moduleName.toUpperCase() + '_API';
        const classHeaderDecl = parentClassName.length > 0 
            ? `class ${moduleAPI} ${prefixedClassName} : public ${parentClassName}` 
            : `class ${moduleAPI} ${className}`;
        const copyright = this.getCopyrightSetting();
        return `// ${copyright}

#pragma once

#include "${includeFile}"
#include "${className}.generated.h"

/**
*
*/
UCLASS()
${classHeaderDecl}
{
    GENERATED_BODY()

};
`;
    }

    private generateCpp(headerIncludePath: string): string {
        const copyright = this.getCopyrightSetting();
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
# Unreal Class Creator

A VS Code extension designed to streamline the creation of C++ classes for Unreal Engine projects. This tool automates the boilerplate process, ensuring classes are created with the correct headers, inheritance, and project-specific copyright information.

It can also regenerate the project files for VSCode and Visual Studio without having to launch the editor. If you're running into an issue generating the project files, it maybe due to the default terminal profile you've selected. A complex profile can interfere with escaping in the generation command. You can fix this by adding an entry into you settings.json e.g.: `"terminal.integrated.automationProfile.windows": { "path": "pwsh.exe" }`

## ⚙️ Configuration

You can customize the extension behavior in your VS Code settings:

| Setting | Description | Default |
| --- | --- | --- |
| `unrealClassCreator.copyrightText` | The copyright notice at the top of files. | `Copyright © ${year} Your Name...` |

## 🛠️ Installation

1. Download the `.vsix` file from the [Releases](https://github.com/geekrelief/vscode_unreal_class_gen/releases) page.
2. In VS Code, open the Extensions view (`Ctrl+Shift+X`).
3. Click the **...** (Views and More Actions) and select **Install from VSIX...**.


### Running

1. Open your VSCode Unreal workspace.
3. Use the "Unreal Class Creator" icon in the Activity Bar to open the generator panel.


### Development notes:
  * npm run compile  - to compile
  * npm run watch - to watch

### Debug
  * run with F5 
  * open console command - Developer: Open Webview Developer Tools

### Package: 
  * update package.json version
  * update CHANGELOG.md
  * git tag -a "version" -m "version"
  * git push origin
  * git push origin --tags
  * package command: vsce package
  * create a new release on github
V1.4.5
## Added -nodotnet flag for project generator. After project generation, the code-workspace settings adds 	"dotnet.defaultSolution": "disable" The VSCode Microsoft C# extension was complaining about AutomationTool .csproj files needing `donet restore`.

V1.4.4
## Minor cleanup

V1.4.3
## Added a button for the Parent Header, so the path can be saved to the settings. If new parent class is used, modify the parent header and click the edit icon to save it. Or if the setting type or path changes, those can be edited and saved too. Save before generating the new class to make sure the settings apply.

V1.3.0
## Added a user updatable map of classes to there header file locations. When user enters the parent class, its used to lookup the header file path that's used in the generated header file. The user can update this path and specify whether the entry should be saved in the workspace or globally.

V1.2.0
## Adds the ability to regenerate the project files using UBT. Cleaned up the UI.
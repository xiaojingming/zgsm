import * as assert from "assert"
import * as vscode from "vscode"

import { Package } from "@roo-code/types"

suite("Costrict Extension", () => {
	test("Commands should be registered", async () => {
		const expectedCommands = [
			"zgsm.plusButtonClicked",
			"zgsm.mcpButtonClicked",
			"zgsm.historyButtonClicked",
			"zgsm.popoutButtonClicked",
			"zgsm.settingsButtonClicked",
			"zgsm.openInNewTab",
			"zgsm.explainCode",
			"zgsm.fixCode",
			"zgsm.improveCode",
			"SidebarProvider.open",
			"SidebarProvider.focus",
			"SidebarProvider.resetViewLocation",
			"SidebarProvider.toggleVisibility",
			"SidebarProvider.removeView",
			"activationCompleted",
			"plusButtonClicked",
			"mcpButtonClicked",
			"promptsButtonClicked",
			"popoutButtonClicked",
			"openInNewTab",
			"settingsButtonClicked",
			"historyButtonClicked",
			"showHumanRelayDialog",
			"registerHumanRelayCallback",
			"unregisterHumanRelayCallback",
			"handleHumanRelayResponse",
			"newTask",
			"setCustomStoragePath",
			"focusInput",
			"acceptInput",
			"explainCode",
			"fixCode",
			"improveCode",
			"addToContext",
			"terminalAddToContext",
			"terminalFixCommand",
			"terminalExplainCommand",
		]

		const commands = new Set(
			(await vscode.commands.getCommands(true)).filter((cmd) => cmd.startsWith(Package.name)),
		)

		for (const command of expectedCommands) {
			assert.ok(commands.has(`${Package.name}.${command}`), `Command ${command} should be registered`)
		}
	})
})

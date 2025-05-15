import * as vscode from "vscode"
import delay from "delay"

import { ClineProvider } from "../core/webview/ClineProvider"
import { ContextProxy } from "../core/config/ContextProxy"
import { telemetryService } from "../services/telemetry/TelemetryService"

import { registerHumanRelayCallback, unregisterHumanRelayCallback, handleHumanRelayResponse } from "./humanRelay"
import { handleNewTask } from "./handleTask"

/**
 * Helper to get the visible ClineProvider instance or log if not found.
 */
export function getVisibleProviderOrLog(outputChannel: vscode.OutputChannel): ClineProvider | undefined {
	const visibleProvider = ClineProvider.getVisibleInstance()
	if (!visibleProvider) {
		outputChannel.appendLine("Cannot find any visible Roo Code instances.")
		return undefined
	}
	return visibleProvider
}

// Store panel references in both modes
let sidebarPanel: vscode.WebviewView | undefined = undefined
let tabPanel: vscode.WebviewPanel | undefined = undefined

/**
 * Get the currently active panel
 * @returns WebviewPanel or WebviewView
 */
export function getPanel(): vscode.WebviewPanel | vscode.WebviewView | undefined {
	return tabPanel || sidebarPanel
}

/**
 * Set panel references
 */
export function setPanel(
	newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
	type: "sidebar" | "tab",
): void {
	if (type === "sidebar") {
		sidebarPanel = newPanel as vscode.WebviewView
		tabPanel = undefined
	} else {
		tabPanel = newPanel as vscode.WebviewPanel
		sidebarPanel = undefined
	}
}

export type RegisterCommandOptions = {
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
	provider: ClineProvider
}

export const registerCommands = (options: RegisterCommandOptions) => {
	const { context } = options

	for (const [command, callback] of Object.entries(getCommandsMap(options))) {
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}
}

const getCommandsMap = ({ context, outputChannel, provider }: RegisterCommandOptions) => {
	return {
		"vscode-zgsm.activationCompleted": () => {},
		"vscode-zgsm.plusButtonClicked": async () => {
			const visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				return
			}

			telemetryService.captureTitleButtonClicked("plus")

			await visibleProvider.removeClineFromStack()
			await visibleProvider.postStateToWebview()
			await visibleProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		},
		"vscode-zgsm.mcpButtonClicked": () => {
			const visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				return
			}

			telemetryService.captureTitleButtonClicked("mcp")

			visibleProvider.postMessageToWebview({ type: "action", action: "mcpButtonClicked" })
		},
		"vscode-zgsm.promptsButtonClicked": () => {
			const visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				return
			}

			telemetryService.captureTitleButtonClicked("prompts")

			visibleProvider.postMessageToWebview({ type: "action", action: "promptsButtonClicked" })
		},
		"vscode-zgsm.popoutButtonClicked": () => {
			telemetryService.captureTitleButtonClicked("popout")

			return openClineInNewTab({ context, outputChannel })
		},
		"vscode-zgsm.openInNewTab": () => openClineInNewTab({ context, outputChannel }),
		"vscode-zgsm.settingsButtonClicked": () => {
			const visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				return
			}

			telemetryService.captureTitleButtonClicked("settings")

			visibleProvider.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })
			// Also explicitly post the visibility message to trigger scroll reliably
			visibleProvider.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
		},
		"vscode-zgsm.historyButtonClicked": () => {
			const visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				return
			}

			telemetryService.captureTitleButtonClicked("history")

			visibleProvider.postMessageToWebview({ type: "action", action: "historyButtonClicked" })
		},
		"vscode-zgsm.helpButtonClicked": () => {
			vscode.env.openExternal(vscode.Uri.parse("https://zgsm.ai"))
		},
		"vscode-zgsm.showHumanRelayDialog": (params: { requestId: string; promptText: string }) => {
			const panel = getPanel()

			if (panel) {
				panel?.webview.postMessage({
					type: "showHumanRelayDialog",
					requestId: params.requestId,
					promptText: params.promptText,
				})
			}
		},
		"vscode-zgsm.registerHumanRelayCallback": registerHumanRelayCallback,
		"vscode-zgsm.unregisterHumanRelayCallback": unregisterHumanRelayCallback,
		"vscode-zgsm.handleHumanRelayResponse": handleHumanRelayResponse,
		"vscode-zgsm.newTask": handleNewTask,
		"vscode-zgsm.setCustomStoragePath": async () => {
			const { promptForCustomStoragePath } = await import("../shared/storagePathManager")
			await promptForCustomStoragePath()
		},
		"vscode-zgsm.focusInput": async () => {
			try {
				const panel = getPanel()

				if (!panel) {
					await vscode.commands.executeCommand("workbench.view.extension.roo-cline-ActivityBar")
				} else if (panel === tabPanel) {
					panel.reveal(vscode.ViewColumn.Active, false)
				} else if (panel === sidebarPanel) {
					await vscode.commands.executeCommand(`${ClineProvider.sideBarId}.focus`)
					provider.postMessageToWebview({ type: "action", action: "focusInput" })
				}
			} catch (error) {
				outputChannel.appendLine(`Error focusing input: ${error}`)
			}
		},
		"vscode-zgsm.acceptInput": () => {
			const visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				return
			}

			visibleProvider.postMessageToWebview({ type: "acceptInput" })
		},
	}
}

export const openClineInNewTab = async ({ context, outputChannel }: Omit<RegisterCommandOptions, "provider">) => {
	// (This example uses webviewProvider activation event which is necessary to
	// deserialize cached webview, but since we use retainContextWhenHidden, we
	// don't need to use that event).
	// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	const contextProxy = await ContextProxy.getInstance(context)
	const tabProvider = new ClineProvider(context, outputChannel, "editor", contextProxy)
	const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

	// Check if there are any visible text editors, otherwise open a new group
	// to the right.
	const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

	if (!hasVisibleEditors) {
		await vscode.commands.executeCommand("workbench.action.newGroupRight")
	}

	const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "SHENMA", targetCol, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [context.extensionUri],
	})

	// Save as tab type panel.
	setPanel(newPanel, "tab")

	// TODO: Use better svg icon with light and dark variants (see
	// https://stackoverflow.com/questions/58365687/vscode-extension-iconpath).
	newPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "zgsm", "images", "zhuge_shenma_rebot_logo_big.png")
	// newPanel.iconPath = {
	// 	light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_light.png"),
	// 	dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_dark.png"),
	// }

	await tabProvider.resolveWebviewView(newPanel)

	// Add listener for visibility changes to notify webview
	newPanel.onDidChangeViewState(
		(e) => {
			const panel = e.webviewPanel
			if (panel.visible) {
				panel.webview.postMessage({ type: "action", action: "didBecomeVisible" }) // Use the same message type as in SettingsView.tsx
			}
		},
		null, // First null is for `thisArgs`
		context.subscriptions, // Register listener for disposal
	)

	// Handle panel closing events.
	newPanel.onDidDispose(
		() => {
			setPanel(undefined, "tab")
		},
		null,
		context.subscriptions, // Also register dispose listener
	)

	// Lock the editor group so clicking on files doesn't open them over the panel.
	await delay(100)
	await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

	return tabProvider
}

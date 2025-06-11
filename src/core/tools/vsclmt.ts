import * as vscode from "vscode"
import { formatResponse } from "../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { Task } from "../task/Task"

export async function useVSCLMT(
	cline: Task,
	toolUse: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
): Promise<void> {
	const { tool_name, arguments: toolArgs } = toolUse.params

	// Handle partial tool invocation (missing parameters)
	if (toolUse.partial) {
		const partialMessage = JSON.stringify({
			type: "vsclmt_tool",
			toolName: removeClosingTag("tool_name", tool_name),
			arguments: removeClosingTag("arguments", toolArgs),
		})

		await cline.ask("tool", partialMessage, toolUse.partial).catch(() => { })
		return
	}

	// Non-partial: require tool_name
	if (!tool_name) {
		cline.recordToolError("use_vsclmt")
		pushToolResult(await cline.sayAndCreateMissingParamError("use_vsclmt", "tool_name"))
		return
	}

	// Get the vsclmt service from ClineProvider
	const provider = cline.providerRef.deref()
	const vsclmtService = provider?.getVSCLMToolService()

	if (!vsclmtService) {
		pushToolResult(formatResponse.toolError("VS Code LM tool system not available"))
		return
	}

	// Parse arguments if provided
	let parsedArgs: any = {}
	if (toolArgs) {
		try {
			parsedArgs = JSON.parse(toolArgs)
		} catch (error) {
			pushToolResult(formatResponse.toolError(`Invalid JSON arguments: ${error.stack || error.message}`))
			return
		}
	}

	try {
		// Check if tool is selected
		if (!vsclmtService.isToolSelected(tool_name)) {
			pushToolResult(
				formatResponse.toolError(
					`Tool '${tool_name}' is not selected for use. Please select it in the Tool Selection panel.`,
				),
			)
			return
		}

		// Prepare tool invocation to get any user confirmation message
		const prepared = await vsclmtService.prepareToolInvocation(tool_name, parsedArgs)
		if (prepared?.confirmationMessages) {
			// Ask for approval with the tool's custom confirmation message
			const message =
				prepared.confirmationMessages.message instanceof vscode.MarkdownString
					? prepared.confirmationMessages.message.value
					: prepared.confirmationMessages.message

			const confirmText = `${prepared.confirmationMessages.title}\n${message}`
			const approved = await askApproval("tool", confirmText)

			if (!approved) {
				pushToolResult(formatResponse.toolDenied())
				return
			}
		}

		// Invoke the tool with any progress message from preparation
		const result = await vsclmtService.invokeTool(tool_name, parsedArgs)

		// Format the result for display
		const resultText = result.content
			.map(part =>
				typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string' ?
					(part as { value: string }).value :
					String(part)
			)
			.join('\n\n')

		pushToolResult(resultText)
	} catch (error) {
		await handleError("VS Code LM tool invocation", error)
		pushToolResult(formatResponse.toolError(`Failed to invoke VS Code LM tool '${tool_name}': ${error.stack || error.message}`))
	}
}

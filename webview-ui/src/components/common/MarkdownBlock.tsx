import React, { memo, useEffect } from "react"
import { useRemark } from "react-remark"
import styled from "styled-components"
import { visit } from "unist-util-visit"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import CodeBlock from "./CodeBlock"
import MermaidBlock from "./MermaidBlock"
import rehypeRaw from "rehype-raw"
import { MARK_TYPE_MAP } from "./const"

interface MarkdownBlockProps {
	markdown?: string
}

/**
 * Custom remark plugin that converts plain URLs in text into clickable links
 *
 * The original bug: We were converting text nodes into paragraph nodes,
 * which broke the markdown structure because text nodes should remain as text nodes
 * within their parent elements (like paragraphs, list items, etc.).
 * This caused the entire content to disappear because the structure became invalid.
 */
const remarkUrlToLink = () => {
	return (tree: any) => {
		// Visit all "text" nodes in the markdown AST (Abstract Syntax Tree)
		visit(tree, "text", (node: any, index, parent) => {
			const urlRegex = /https?:\/\/[^\s<>)"]+/g
			const matches = node.value.match(urlRegex)

			if (!matches) {
				return
			}

			const parts = node.value.split(urlRegex)
			const children: any[] = []

			parts.forEach((part: string, i: number) => {
				if (part) {
					children.push({ type: "text", value: part })
				}

				if (matches[i]) {
					children.push({ type: "link", url: matches[i], children: [{ type: "text", value: matches[i] }] })
				}
			})

			// Fix: Instead of converting the node to a paragraph (which broke things),
			// we replace the original text node with our new nodes in the parent's children array.
			// This preserves the document structure while adding our links.
			if (parent) {
				parent.children.splice(index, 1, ...children)
			}
		})
	}
}

const StyledMarkdown = styled.div`
	code:not(pre > code) {
		font-family: var(--vscode-editor-font-family, monospace);
		filter: saturation(110%) brightness(95%);
		color: var(--vscode-textPreformat-foreground) !important;
		background-color: var(--vscode-textPreformat-background) !important;
		padding: 0px 2px;
		white-space: pre-line;
		word-break: break-word;
		overflow-wrap: anywhere;
	}

	/* Target only Dark High Contrast theme using the data attribute VS Code adds to the body */
	body[data-vscode-theme-kind="vscode-high-contrast"] & code:not(pre > code) {
		color: var(
			--vscode-editorInlayHint-foreground,
			var(--vscode-symbolIcon-stringForeground, var(--vscode-charts-orange, #e9a700))
		);
	}

	font-family:
		var(--vscode-font-family),
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		"Segoe UI",
		Roboto,
		Oxygen,
		Ubuntu,
		Cantarell,
		"Open Sans",
		"Helvetica Neue",
		sans-serif;

	font-size: var(--vscode-font-size, 13px);

	p,
	li,
	ol,
	ul {
		line-height: 1.25;
	}

	ol,
	ul {
		padding-left: 2.5em;
		margin-left: 0;
	}

	p {
		white-space: pre-wrap;
	}

	a {
		color: var(--vscode-textLink-foreground);
		text-decoration-line: underline;
		text-decoration-style: dotted;
		text-decoration-color: var(--vscode-textLink-foreground);
		&:hover {
			color: var(--vscode-textLink-activeForeground);
			text-decoration-style: solid;
			text-decoration-color: var(--vscode-textLink-activeForeground);
		}
	}
`

const MarkdownBlock = memo(({ markdown }: MarkdownBlockProps) => {
	const { theme, apiConfiguration } = useExtensionState()
	const [reactContent, setMarkdown] = useRemark({
		remarkPlugins: [
			remarkUrlToLink,
			() => {
				return (tree) => {
					visit(tree, "code", (node: any) => {
						if (!node.lang) {
							node.lang = "text"
						} else if (node.lang.includes(".")) {
							node.lang = node.lang.split(".").slice(-1)[0]
						}
					})
				}
			},
		],
		remarkToRehypeOptions: {
			handlers: {
				html: (h: unknown, node: any) => {
					return { type: "raw", value: node.value }
				},
			},
			passThrough: ["span", "div", "a", "p", "strong", "em", "img"],
		},
		rehypePlugins: [rehypeRaw as any],
		rehypeReactOptions: {
			components: {
				a: ({ href, children }: any) => {
					return (
						<a
							href={href}
							title={href}
							onClick={(e) => {
								// Only process file:// protocol or local file paths
								const isLocalPath =
									href.startsWith("file://") || href.startsWith("/") || !href.includes("://")

								if (!isLocalPath) {
									return
								}

								e.preventDefault()

								// Handle absolute vs project-relative paths
								let filePath = href.replace("file://", "")

								// Extract line number if present
								const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
								let values = undefined
								if (match) {
									filePath = match[1]
									values = { line: parseInt(match[2]) }
								}

								// Add ./ prefix if needed
								if (!filePath.startsWith("/") && !filePath.startsWith("./")) {
									filePath = "./" + filePath
								}

								vscode.postMessage({
									type: "openFile",
									text: filePath,
									values,
								})
							}}>
							{children}
						</a>
					)
				},
				pre: ({ node: _, children }: any) => {
					// Check for Mermaid diagrams first
					if (Array.isArray(children) && children.length === 1 && React.isValidElement(children[0])) {
						const child = children[0] as React.ReactElement<{ className?: string }>

						if (child.props?.className?.includes("language-mermaid")) {
							return child
						}
					}

					// For all other code blocks, use CodeBlock with copy button
					const codeNode = children?.[0]

					if (!codeNode?.props?.children) {
						return null
					}

					const language =
						(Array.isArray(codeNode.props?.className)
							? codeNode.props.className
							: [codeNode.props?.className]
						).map((c: string) => c?.replace("language-", ""))[0] || "javascript"

					const rawText = codeNode.props.children[0] || ""
					return <CodeBlock source={rawText} language={language} />
				},
				code: (props: any) => {
					const className = props.className || ""

					if (className.includes("language-mermaid")) {
						const codeText = String(props.children || "")
						return <MermaidBlock code={codeText} />
					}

					return <code {...props} />
				},
				mark: ({ hash, type, children }: any) => {
					if (!type) {
						return null
					}
					const href = `${apiConfiguration?.zgsmBaseUrl || apiConfiguration?.zgsmDefaultBaseUrl}${MARK_TYPE_MAP[type]}${hash}`

					return (
						<a href={href} style={{ textDecoration: "none" }}>
							{children}
						</a>
					)
				},
			},
		},
	})

	useEffect(() => {
		setMarkdown(markdown || "")
	}, [markdown, setMarkdown, theme])

	return (
		<div style={{}}>
			<StyledMarkdown>{reactContent}</StyledMarkdown>
		</div>
	)
})

export default MarkdownBlock

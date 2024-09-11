import { createMarkdownProcessor } from '@astrojs/markdown-remark'

export async function parseMarkdown(content: string) {
	const processor = await createMarkdownProcessor()

	const result = await processor.render(content)

	return result
}
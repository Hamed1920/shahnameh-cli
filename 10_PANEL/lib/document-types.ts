/** What the Prompts page accepts as a dropped file. Client-safe; the extractors live in documents.ts. */
export const DOCUMENT_EXT = ['.txt', '.md', '.json', '.docx', '.pdf'] as const
export const DOCUMENT_ACCEPT = '.txt,.md,.json,.docx,.pdf'
/** Read in the browser with File.text(); everything else goes to the server for extraction. */
export const TEXT_EXT = ['.txt', '.md', '.json'] as const
export const MAX_DOCUMENTS = 10
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

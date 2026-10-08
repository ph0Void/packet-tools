export async function getResponseIA(response: any): Promise<string> {
    const allMessages = response?.messages;

    if (allMessages && Array.isArray(allMessages) && allMessages.length > 0) {
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const msg = allMessages[i];

            if (msg.role === "assistant" || msg._getType?.() === "ai" || msg.constructor.name === "AIMessage") {
                const content = msg.content;

                if (typeof content === "string" && content.trim().length > 0) {
                    return content;
                }

                if (Array.isArray(content)) {
                    const textParts = content
                        .filter((part: any) => part.type === "text" && part.text)
                        .map((part: any) => part.text);
                    if (textParts.length > 0) {
                        return textParts.join("\n");
                    }
                }
            }
        }
    }

    if (response?.content) {
        if (typeof response.content === "string") return response.content;
        if (Array.isArray(response.content)) return JSON.stringify(response.content);
    }

    const fallback = allMessages ? allMessages[allMessages.length - 1]?.content : response?.content;
    return typeof fallback === "string"
        ? fallback
        : (fallback ? JSON.stringify(fallback) : "No se pudo recuperar una respuesta de texto.");
}

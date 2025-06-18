
import { GoogleGenAI, Chat } from "@google/genai";

// const API_KEY = process.env.API_KEY;
const API_KEY = "AIzaSyDUJCG10nIo-s5DCUzSMU0r_DK34TsbXDg";

const CHAT_HISTORY_KEY = 'geminiAIChatHistory';

// Interfaces removed as this is now plain JavaScript.
// Structure of ChatMessage objects: { id: string, sender: 'user' | 'bot', text: string, timestamp: string (ISO), groundingSources?: [{uri: string, title: string}] }

const chatHistoryElement = document.getElementById('chat-history');
const messageInputElement = document.getElementById('message-input') as HTMLTextAreaElement | null;
const sendButtonElement = document.getElementById('send-button') as HTMLButtonElement | null;
const loadingIndicatorElement = document.getElementById('loading-indicator');
const errorMessageElement = document.getElementById('error-message');

let ai = null;
let chat = null;
let chatMessages = [];

// --- LocalStorage Functions ---
function saveChatHistory() {
    try {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatMessages));
    } catch (error) {
        console.error("Error saving chat history to localStorage:", error);
    }
}

function loadChatHistory() {
    try {
        const storedHistory = localStorage.getItem(CHAT_HISTORY_KEY);
        if (storedHistory) {
            return JSON.parse(storedHistory);
        }
    } catch (error) {
        console.error("Error loading chat history from localStorage:", error);
        localStorage.removeItem(CHAT_HISTORY_KEY);
    }
    return [];
}

// --- Error and Loading UI ---
function displayError(message) {
    if (errorMessageElement) {
        errorMessageElement.textContent = message;
        errorMessageElement.style.display = 'block';
    }
    console.error(message);
}

function hideError() {
    if (errorMessageElement) {
        errorMessageElement.style.display = 'none';
    }
}

function showLoading(isLoading) {
    if (loadingIndicatorElement) {
        loadingIndicatorElement.style.display = isLoading ? 'block' : 'none';
    }
    if (sendButtonElement) sendButtonElement.disabled = isLoading;
    if (messageInputElement) messageInputElement.disabled = isLoading;
}

// --- Message Rendering ---
async function handleCopyCode(code, button) {
    try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied!';
        button.disabled = true;
        setTimeout(() => {
            button.textContent = 'Copy';
            button.disabled = false;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy code: ', err);
        button.textContent = 'Error';
        setTimeout(() => {
            button.textContent = 'Copy';
        }, 2000);
    }
}

function processTextSegment(segment) {
    const fragment = document.createDocumentFragment();
    const lines = segment.split('\n');

    lines.forEach((line, lineIndex) => {
        if (line.trim() === '---') {
            fragment.appendChild(document.createElement('hr'));
        } else {
            const lineFragment = document.createDocumentFragment();
            const markdownRegex = /(\*\*(.*?)\*\*|`(.*?)`)/g;
            let currentLineContent = line;
            let lastMatchEnd = 0;
            let matchResult;

            while ((matchResult = markdownRegex.exec(currentLineContent)) !== null) {
                if (matchResult.index > lastMatchEnd) {
                    lineFragment.appendChild(document.createTextNode(currentLineContent.substring(lastMatchEnd, matchResult.index)));
                }
                if (matchResult[1].startsWith('**')) {
                    const strong = document.createElement('strong');
                    strong.textContent = matchResult[2];
                    lineFragment.appendChild(strong);
                } else { 
                    const code = document.createElement('code');
                    code.classList.add('inline-code');
                    code.textContent = matchResult[3]; 
                    lineFragment.appendChild(code);
                }
                lastMatchEnd = markdownRegex.lastIndex;
            }
            if (lastMatchEnd < currentLineContent.length) {
                lineFragment.appendChild(document.createTextNode(currentLineContent.substring(lastMatchEnd)));
            }
            fragment.appendChild(lineFragment);
        }

        if (lineIndex < lines.length - 1) {
            fragment.appendChild(document.createTextNode('\n'));
        }
    });
    return fragment;
}


function renderMessageContent(container, text) {
    container.innerHTML = ''; 

    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const textSegment = text.substring(lastIndex, match.index);
            container.appendChild(processTextSegment(textSegment));
        }

        const language = match[1] || 'plaintext';
        const codeContent = match[2].trim();

        const codeBlockContainer = document.createElement('div');
        codeBlockContainer.className = 'code-block-container';

        const preElement = document.createElement('pre');
        const codeElement = document.createElement('code');
        codeElement.className = `language-${language}`;
        codeElement.textContent = codeContent;
        preElement.appendChild(codeElement);

        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.textContent = 'Copy';
        copyButton.setAttribute('aria-label', `Copy ${language} code to clipboard`);
        copyButton.addEventListener('click', () => handleCopyCode(codeContent, copyButton));
        
        const header = document.createElement('div');
        header.className = 'code-block-header';
        const langSpan = document.createElement('span');
        langSpan.className = 'code-block-language';
        langSpan.textContent = language;
        header.appendChild(langSpan);
        header.appendChild(copyButton);

        codeBlockContainer.appendChild(header);
        codeBlockContainer.appendChild(preElement);
        container.appendChild(codeBlockContainer);

        lastIndex = codeBlockRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        const textSegment = text.substring(lastIndex);
        container.appendChild(processTextSegment(textSegment));
    }
}

function updateGroundingSources(messageBubble, sources) {
    let sourcesContainer = messageBubble.querySelector('.grounding-sources-container');

    if (sourcesContainer) {
        sourcesContainer.remove();
    }

    if (sources && sources.length > 0) {
        sourcesContainer = document.createElement('div');
        sourcesContainer.className = 'grounding-sources-container';

        const sourcesTitle = document.createElement('h4');
        sourcesTitle.textContent = 'Learn more:';
        sourcesContainer.appendChild(sourcesTitle);

        const sourcesList = document.createElement('ul');
        sources.forEach(source => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = source.uri;
            link.textContent = source.title || source.uri; // Fallback to URI if title is missing
            link.target = '_blank';
            link.rel = 'noopener noreferrer'; // Security for opening in new tab
            listItem.appendChild(link);
            sourcesList.appendChild(listItem);
        });
        sourcesContainer.appendChild(sourcesList);
        messageBubble.appendChild(sourcesContainer);
    }
}


function appendMessage(message, isStreamingUpdate = false) {
    if (!chatHistoryElement) return null;

    let messageBubble = document.getElementById(message.id);

    if (messageBubble && isStreamingUpdate) {
        const contentElement = messageBubble.querySelector('.message-content');
        if (contentElement) {
            // Append raw text during streaming for speed
            contentElement.textContent += message.text; 
        }
    } else if (messageBubble && !isStreamingUpdate) { // Finalizing an existing bot message bubble
        const contentElement = messageBubble.querySelector('.message-content');
        if (contentElement) {
            renderMessageContent(contentElement, message.text);
        }
        if (message.sender === 'bot') {
            updateGroundingSources(messageBubble, message.groundingSources);
        }
    } else { // Creating a new message bubble
        messageBubble = document.createElement('div');
        messageBubble.id = message.id;
        messageBubble.classList.add('message-bubble');
        messageBubble.classList.add(message.sender === 'user' ? 'user-message' : 'bot-message');

        if (message.sender === 'bot') {
            const botName = document.createElement('strong');
            botName.textContent = "Bot";
            messageBubble.appendChild(botName);
        }

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');
        renderMessageContent(messageContent, message.text);
        messageBubble.appendChild(messageContent);
        
        if (message.sender === 'bot') {
            updateGroundingSources(messageBubble, message.groundingSources);
        }

        const timestampElement = document.createElement('div');
        timestampElement.classList.add('message-timestamp');
        timestampElement.textContent = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageBubble.appendChild(timestampElement);

        chatHistoryElement.appendChild(messageBubble);
    }
    
    chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    return messageBubble;
}

// --- Chat Logic ---
async function initializeChat() {
    if (!API_KEY) {
        displayError("API_KEY is not configured. Please set the process.env.API_KEY environment variable.");
        if (sendButtonElement) sendButtonElement.disabled = true;
        if (messageInputElement) messageInputElement.disabled = true;
        return;
    }

    try {
        ai = new GoogleGenAI({ apiKey: API_KEY });
        
        const geminiHistory = chatMessages.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        chat = ai.chats.create({
            model: 'gemini-2.5-flash-preview-04-17',
            history: geminiHistory,
            config: {
                systemInstruction: 'You are a helpful and friendly chatbot. When providing code, always use Markdown code blocks like ```language\\ncode here\\n```. For emphasis, use **bold text**. For inline code snippets or filenames, use `backticks`. Use --- on its own new line for horizontal rules. If the user asks for recent information or something that might require web search, use your search tool.',
                tools: [{ googleSearch: {} }], // Enable Google Search tool
            },
        });
        
        chatMessages.forEach(msg => appendMessage(msg));


        if (chatMessages.length === 0) {
            const greetingMessage = {
                id: `message-${Date.now()}-bot-greeting`,
                sender: 'bot',
                text: "Hello! How can I help you today?",
                timestamp: new Date().toISOString()
            };
            chatMessages.push(greetingMessage);
            appendMessage(greetingMessage);
            saveChatHistory();
        }

    } catch (error) {
        console.error("Failed to initialize GoogleGenAI or create chat:", error);
        let errorMsg = "Failed to initialize AI services.";
        if (error instanceof Error) errorMsg += ` ${error.message}`;
        displayError(errorMsg);
        if (sendButtonElement) sendButtonElement.disabled = true;
        if (messageInputElement) messageInputElement.disabled = true;
    }
}

async function handleSendMessage() {
    if (!messageInputElement || !chat || !ai) {
        displayError("Chat components or AI service not initialized.");
        return;
    }

    const messageText = messageInputElement.value.trim();
    if (!messageText) return;

    const userMessage = {
        id: `message-${Date.now()}-user`,
        sender: 'user',
        text: messageText,
        timestamp: new Date().toISOString()
    };
    chatMessages.push(userMessage);
    appendMessage(userMessage);
    saveChatHistory();

    messageInputElement.value = '';
    messageInputElement.style.height = 'auto';
    hideError();
    showLoading(true);

    const botMessageId = `message-${Date.now()}-bot`;
    let accumulatedBotResponse = "";
    const botMessageTimestampISO = new Date().toISOString(); 
    let groundingSources = undefined;

    let botMessageBubble = appendMessage({ 
        id: botMessageId, 
        sender: 'bot', 
        text: '', // Start with empty text for streaming
        timestamp: botMessageTimestampISO
    });
    
    let botMessageContentElement = null;
    if (botMessageBubble) {
        botMessageContentElement = botMessageBubble.querySelector('.message-content');
    }

    if (!botMessageContentElement) {
         console.error("Could not find/create bot message content element for streaming.");
         displayError("An error occurred displaying the bot's response.");
         showLoading(false);
         return;
    }

    try {
        const stream = await chat.sendMessageStream({ message: messageText });
        for await (const chunk of stream) {
            const chunkText = chunk.text;
            if (chunkText) {
                accumulatedBotResponse += chunkText;
                botMessageContentElement.textContent = accumulatedBotResponse; // Live update with raw text
                chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
            }
            // Check for grounding metadata in any chunk
            if (chunk.candidates && chunk.candidates[0]?.groundingMetadata?.groundingChunks) {
                groundingSources = chunk.candidates[0].groundingMetadata.groundingChunks
                    .map(gc => ({
                        uri: gc.web?.uri || '', 
                        title: gc.web?.title || gc.web?.uri || 'Source' 
                    }))
                    .filter(gs => gs.uri); // Only include if URI is present
            }
        }
        
        const finalBotMessage = {
            id: botMessageId, 
            sender: 'bot',
            text: accumulatedBotResponse,
            timestamp: botMessageTimestampISO,
            groundingSources: groundingSources
        };
        
        const existingMsgIndex = chatMessages.findIndex(m => m.id === botMessageId);
        if (existingMsgIndex > -1) {
            chatMessages[existingMsgIndex] = finalBotMessage;
        } else {
            chatMessages.push(finalBotMessage);
        }
        
        renderMessageContent(botMessageContentElement, accumulatedBotResponse);
        if (botMessageBubble) {
            updateGroundingSources(botMessageBubble, groundingSources);
        }
        saveChatHistory();

    } catch (error) {
        console.error("Error sending message or processing stream:", error);
        let errorDisplayMessage = "An error occurred while communicating with the AI.";
        if (error instanceof Error && error.message) {
             errorDisplayMessage += ` Details: ${error.message}`;
        } else if (typeof error === 'string') {
            errorDisplayMessage += ` Details: ${error}`;
        }
        displayError(errorDisplayMessage);
        
        const errorText = accumulatedBotResponse ? accumulatedBotResponse + `\n\n[Error retrieving full response]` : `[Error retrieving response]`;
        if (botMessageContentElement) {
             renderMessageContent(botMessageContentElement, errorText);
        }
         if (botMessageBubble && groundingSources && groundingSources.length > 0) {
             updateGroundingSources(botMessageBubble, groundingSources); 
        }

        const errorBotMessage = {
            id: botMessageId,
            sender: 'bot',
            text: errorText,
            timestamp: botMessageTimestampISO,
            groundingSources: groundingSources 
        };
        const existingMsgIndex = chatMessages.findIndex(m => m.id === botMessageId);
        if (existingMsgIndex > -1) {
            chatMessages[existingMsgIndex] = errorBotMessage;
        } else {
            chatMessages.push(errorBotMessage);
        }
        saveChatHistory();

    } finally {
        showLoading(false);
        if (messageInputElement) {
           messageInputElement.focus();
        }
    }
}

// --- Event Listeners and Initialization ---
if (sendButtonElement && messageInputElement) {
    sendButtonElement.addEventListener('click', handleSendMessage);
    messageInputElement.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
        }
    });
    messageInputElement.addEventListener('input', () => {
        if (messageInputElement) { // Check added for type safety
            messageInputElement.style.height = 'auto';
            messageInputElement.style.height = `${messageInputElement.scrollHeight}px`;
        }
    });
} else {
    console.error("Could not find send button or message input elements.");
}

window.addEventListener('load', () => {
    chatMessages = loadChatHistory();
    initializeChat(); 
});

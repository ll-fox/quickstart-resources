declare module 'openai' {
  export class OpenAI {
    constructor(options: { apiKey: string, baseURL?: string });
    chat: {
      completions: {
        create: (params: any) => Promise<any>;
      };
    };
  }
}

declare module 'openai/resources' {
  export interface ChatCompletionTool {
    type: string;
    function: {
      name: string;
      description?: string;
      parameters: any;
    };
  }

  export interface ChatCompletionMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_call_id?: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }
} 
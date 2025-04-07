import { OpenAI } from "openai";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import readline from "readline/promises";

import dotenv from "dotenv";

dotenv.config(); // load environment variables from .env

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const DEEPSEEK_API_BASE = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "";
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

// 自定义类型定义，兼容OpenAI接口
interface ChatCompletionTool {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters: any;
  };
}

interface ChatCompletionMessage {
  role: string; // 使用string类型来避免类型错误
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

// 连接模式枚举
enum ConnectionMode {
  LOCAL_SCRIPT = "local_script",
  WEBSOCKET = "websocket",
  SSE = "sse",
}

class MCPClient {
  private mcp: Client;
  private openai: OpenAI;
  private transport: StdioClientTransport | WebSocketClientTransport | SSEClientTransport | null = null;
  private tools: ChatCompletionTool[] = [];

  constructor() {
    // 初始化OpenAI客户端和MCP客户端
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
      baseURL: DEEPSEEK_API_BASE, // 使用DeepSeek的API端点
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  /**
   * 连接到线上MCP服务器
   * 
   * @param serverUrl - MCP服务器的URL，例如 "ws://example.com/mcp" 或 "https://example.com/mcp"
   * @param mode - 连接模式：websocket 或 sse
   */
  async connectToRemoteServer(serverUrl: string, mode: ConnectionMode.WEBSOCKET | ConnectionMode.SSE) {
    try {
      // 创建URL对象
      const url = new URL(serverUrl);

      // 根据连接模式创建适当的传输
      if (mode === ConnectionMode.WEBSOCKET) {
        this.transport = new WebSocketClientTransport(url);
      } else if (mode === ConnectionMode.SSE) {
        this.transport = new SSEClientTransport(url);
      }

      if (!this.transport) {
        throw new Error("无效的连接模式");
      }

      // 连接到服务器
      this.mcp.connect(this.transport);

      // 列出可用工具
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          }
        } as ChatCompletionTool;
      });
      console.log(
        "已连接到线上服务器，可用工具：",
        this.tools.map((tool) => tool.function.name),
      );
    } catch (e) {
      console.log("连接MCP服务器失败: ", e);
      throw e;
    }
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // Determine script type and appropriate command
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;

      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      this.mcp.connect(this.transport);

      // List available tools
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          }
        } as ChatCompletionTool;
      });
      console.log(
        "已连接到服务器，可用工具：",
        this.tools.map((tool) => tool.function.name),
      );
    } catch (e) {
      console.log("连接MCP服务器失败: ", e);
      throw e;
    }
  }

  async processQuery(query: string) {
    /**
     * Process a query using DeepSeek model and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    const messages: ChatCompletionMessage[] = [
      {
        role: "user",
        content: query,
      },
    ];

    // 使用OpenAI API调用DeepSeek模型
    // 参数说明：
    // - model: 指定使用的DeepSeek模型
    // - max_tokens: 限制响应最大token数为1000，控制响应长度
    // - messages: 包含用户查询的消息数组
    // - tools: 传入可用的工具列表，供模型选择调用
    const response = await this.openai.chat.completions.create({
      model: "deepseek-chat", // 使用DeepSeek模型，根据实际可用模型调整
      max_tokens: 1000,
      messages: messages as any, // 使用类型断言解决类型不匹配问题
      tools: this.tools as any, // 使用类型断言解决类型不匹配问题
    });

    // 处理模型的响应并处理工具调用
    const finalText: string[] = []; // 存储最终输出的文本
    const toolResults: any[] = []; // 存储工具调用结果

    // 获取模型响应内容
    if (response.choices && response.choices.length > 0) {
      const choice = response.choices[0];

      // 如果有普通文本内容，添加到最终输出
      if (choice.message.content) {
        finalText.push(choice.message.content);
      }

      // 如果有工具调用
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === 'function') {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

            // 调用MCP工具
            const result = await this.mcp.callTool({
              name: toolName,
              arguments: toolArgs,
            });
            toolResults.push(result);
            finalText.push(`[调用工具 ${toolName}，参数：${JSON.stringify(toolArgs)}]`);

            // 将工具调用结果作为新消息加入对话
            messages.push(choice.message as any);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolName,
              content: result.content as string,
            });

            // 获取模型对工具调用结果的响应
            const followUpResponse = await this.openai.chat.completions.create({
              model: "deepseek-chat", // 使用DeepSeek模型
              max_tokens: 1000,
              messages: messages as any, // 使用类型断言解决类型不匹配问题
            });

            // 将模型的响应添加到最终输出
            if (followUpResponse.choices && followUpResponse.choices.length > 0 &&
              followUpResponse.choices[0].message.content) {
              finalText.push(followUpResponse.choices[0].message.content);
            }
          }
        }
      }
    }

    // 将所有文本片段用换行符连接并返回
    return finalText.join("\n");
  }

  async chatLoop() {
    /**
     * Run an interactive chat loop
     */
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP客户端已启动！");
      console.log("输入您的问题或输入'quit'退出。");

      while (true) {
        const message = await rl.question("\n问题: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    await this.mcp.close();
  }
}

async function main() {
  const mcpClient = new MCPClient();
  try {
    // 检查命令行参数
    if (process.argv.length < 3) {
      console.log("用法:");
      console.log("1. 本地脚本: node build/index.js <path_to_server_script>");
      console.log("2. WebSocket服务器: node build/index.js --ws <server_url>");
      console.log("3. SSE服务器: node build/index.js --sse <server_url>");

      // 检查环境变量中是否有MCP_SERVER_URL
      if (MCP_SERVER_URL) {
        console.log("\n检测到环境变量MCP_SERVER_URL，尝试连接...");
        // 默认使用WebSocket方式连接
        await mcpClient.connectToRemoteServer(MCP_SERVER_URL, ConnectionMode.WEBSOCKET);
        await mcpClient.chatLoop();
      }
      return;
    }

    const arg = process.argv[2];

    // 根据命令行参数决定连接方式
    if (arg === "--ws" || arg === "--websocket") {
      // WebSocket连接
      if (process.argv.length < 4) {
        throw new Error("缺少WebSocket服务器URL");
      }
      await mcpClient.connectToRemoteServer(process.argv[3], ConnectionMode.WEBSOCKET);
    } else if (arg === "--sse") {
      // SSE连接
      if (process.argv.length < 4) {
        throw new Error("缺少SSE服务器URL");
      }
      await mcpClient.connectToRemoteServer(process.argv[3], ConnectionMode.SSE);
    } else {
      // 本地脚本连接
      await mcpClient.connectToServer(arg);
    }

    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();

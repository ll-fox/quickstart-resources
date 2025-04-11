import { OpenAI } from "openai";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import readline from "readline";
// 导入dotenv库，用于加载环境变量
import dotenv from "dotenv";

// 调用dotenv.config()方法，从项目根目录下的.env文件中加载环境变量
// 该方法会将.env文件中的键值对注入到process.env对象中
// 这样可以在代码中通过process.env访问这些环境变量
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const DEEPSEEK_API_BASE = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "";
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

// 设置日志级别
const LOG_LEVEL = process.env.LOG_LEVEL || "debug"; // debug, info, warn, error

// 日志工具函数
const logger = {
  debug: (message: string, ...args: any[]) => {
    if (LOG_LEVEL === "debug") {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") {
      console.log(`[INFO] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (LOG_LEVEL === "debug" || LOG_LEVEL === "info" || LOG_LEVEL === "warn") {
      console.log(`[WARN] ${message}`, ...args);
    }
  },
  error: (message: string, error?: any) => {
    console.log(`[ERROR] ${message}`);
    if (error) {
      if (error instanceof Error) {
        console.log(`  - 错误名称: ${error.name}`);
        console.log(`  - 错误信息: ${error.message}`);
        console.log(`  - 错误堆栈: ${error.stack}`);
      } else {
        console.log(`  - 错误详情:`, error);
      }
    }
  }
};

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
    try {
      logger.info("初始化OpenAI和MCP客户端");
      this.openai = new OpenAI({
        apiKey: OPENAI_API_KEY,
        baseURL: DEEPSEEK_API_BASE, // 使用DeepSeek的API端点
      });
      this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
      logger.info("客户端初始化成功");
    } catch (error) {
      logger.error("初始化客户端失败", error);
      throw error;
    }
  }

  /**
   * 连接到线上MCP服务器
   * 
   * @param serverUrl - MCP服务器的URL，例如 "ws://example.com/mcp" 或 "https://example.com/mcp"
   * @param mode - 连接模式：websocket 或 sse
   */
  async connectToRemoteServer(serverUrl: string, mode: ConnectionMode.WEBSOCKET | ConnectionMode.SSE) {
    try {
      logger.info(`尝试连接到远程服务器: ${serverUrl}，模式: ${mode}`);
      // 创建URL对象
      const url = new URL(serverUrl);

      // 根据连接模式创建适当的传输
      if (mode === ConnectionMode.WEBSOCKET) {
        logger.debug("创建WebSocket传输...");
        this.transport = new WebSocketClientTransport(url);
      } else if (mode === ConnectionMode.SSE) {
        logger.debug("创建SSE传输...");
        this.transport = new SSEClientTransport(url);
      }

      if (!this.transport) {
        throw new Error("无效的连接模式");
      }

      // 连接到服务器
      logger.debug("连接到MCP服务器...");
      this.mcp.connect(this.transport);

      // 列出可用工具
      logger.debug("获取可用工具列表...");
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
      logger.info(
        "已连接到线上服务器，可用工具：",
        this.tools.map((tool) => tool.function.name),
      );
    } catch (error) {
      logger.error("连接MCP服务器失败", error);
      throw error;
    }
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      logger.info(`尝试连接到本地服务器脚本: ${serverScriptPath}`);

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

      logger.debug(`使用命令: ${command} 运行脚本`);

      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });

      logger.debug("连接到MCP服务器...");
      this.mcp.connect(this.transport);

      // List available tools
      logger.debug("获取可用工具列表...");
      const toolsResult = await this.mcp.listTools();
      logger.debug("工具列表原始数据:", JSON.stringify(toolsResult, null, 2));

      this.tools = toolsResult.tools.map((tool) => {
        logger.debug(`处理工具: ${tool.name}`, tool);
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          }
        } as ChatCompletionTool;
      });
      logger.info(
        "已连接到服务器，可用工具：",
        this.tools.map((tool) => tool.function.name),
      );

      logger.debug("工具详情:", JSON.stringify(this.tools, null, 2));
    } catch (error) {
      logger.error("连接MCP服务器失败", error);
      throw error;
    }
  }

  async processQuery(query: string) {
    /**
     * Process a query using DeepSeek model and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    try {
      logger.info(`处理用户查询: "${query}"`);

      const messages: ChatCompletionMessage[] = [
        {
          role: "user",
          content: query,
        },
      ];

      logger.debug("发送消息到模型:", JSON.stringify(messages, null, 2));
      // logger.debug("可用工具:", JSON.stringify(this.tools.map(t => t.function.name), null, 2));

      // 使用OpenAI API调用DeepSeek模型
      logger.debug("发送请求到DeepSeek模型...");
      // logger.debug("工具列表:", JSON.stringify(this.tools, null, 2));

      const response = await this.openai.chat.completions.create({
        model: "deepseek-chat", // 使用DeepSeek模型，根据实际可用模型调整
        max_tokens: 1000,
        messages: messages as any, // 使用类型断言解决类型不匹配问题
        tools: this.tools as any, // 使用类型断言解决类型不匹配问题
      });

      // logger.debug("收到模型响应:", JSON.stringify(response, null, 2));

      // 处理模型的响应并处理工具调用
      const finalText: string[] = []; // 存储最终输出的文本
      const toolResults: any[] = []; // 存储工具调用结果

      // 获取模型响应内容
      if (response.choices && response.choices.length > 0) {
        const choice = response.choices[0];
        logger.debug("模型选择:", JSON.stringify(choice, null, 2));

        // 如果有普通文本内容，添加到最终输出
        if (choice.message.content) {
          logger.debug("收到模型文本响应:", choice.message.content);
          finalText.push(choice.message.content);
        }

        // 如果有工具调用
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          logger.info(`模型选择调用工具，数量: ${choice.message.tool_calls.length}`);

          for (const toolCall of choice.message.tool_calls) {
            if (toolCall.type === 'function') {
              const toolName = toolCall.function.name;
              const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

              logger.info(`准备调用工具: ${toolName}，参数:`, toolArgs);

              try {
                // 调用MCP工具
                logger.debug(`开始调用MCP工具: ${toolName}`);
                const result = await this.mcp.callTool({
                  name: toolName,
                  arguments: toolArgs,
                });
                logger.debug(`工具调用结果:`, result);

                toolResults.push(result);
                finalText.push(`[调用工具 ${toolName}，参数：${JSON.stringify(toolArgs)}]`);
                logger.info(`工具 ${toolName}.callTool() 调用成功`);

                // 将工具调用结果作为新消息加入对话
                messages.push(choice.message as any);
                messages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: toolName,
                  content: Array.isArray(result.content)
                    ? result.content.map(item => item.text || "").join("\n")
                    : typeof result.content === 'string'
                      ? result.content
                      : JSON.stringify(result.content),
                });
                logger.debug("将工具结果添加到消息中:", JSON.stringify(messages, null, 2));

                // 获取模型对工具调用结果的响应
                logger.debug("将工具结果发送回DeepSeek模型...");
                const followUpResponse = await this.openai.chat.completions.create({
                  model: "deepseek-chat", // 使用DeepSeek模型
                  max_tokens: 1000,
                  messages: messages as any, // 使用类型断言解决类型不匹配问题
                });
                logger.debug("收到模型对工具结果的响应:", JSON.stringify(followUpResponse, null, 2));

                // 将模型的响应添加到最终输出
                if (followUpResponse.choices && followUpResponse.choices.length > 0 &&
                  followUpResponse.choices[0].message.content) {
                  logger.debug("添加模型对工具结果的响应到输出");
                  finalText.push(followUpResponse.choices[0].message.content);
                }
              } catch (toolError) {
                logger.error(`工具 ${toolName} 调用失败`, toolError);
                finalText.push(`[错误] 工具 ${toolName} 调用失败: ${toolError instanceof Error ? toolError.message : String(toolError)}`);
              }
            }
          }
        } else {
          logger.warn("模型未选择调用任何工具，直接返回文本响应");
        }
      } else {
        logger.warn("DeepSeek模型未返回任何选择");
      }

      // 将所有文本片段用换行符连接并返回
      logger.debug("最终文本片段:", finalText);
      return finalText.join("\n");
    } catch (error) {
      logger.error("处理查询时发生错误", error);
      return `处理查询时发生错误: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async directToolCall(toolName: string, args: any = {}) {
    try {
      logger.info(`直接调用工具: ${toolName}，参数:`, args);

      const result = await this.mcp.callTool({
        name: toolName,
        arguments: args,
      });

      logger.debug(`工具调用结果:`, result);
      return `工具 ${toolName} 调用结果:\n${Array.isArray(result.content)
        ? result.content.map(item => item.text || "").join("\n")
        : typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content, null, 2)
        }`;
    } catch (error) {
      logger.error(`直接工具调用失败: ${toolName}`, error);
      return `调用工具 ${toolName} 失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async chatLoop() {
    /**
     * Run an interactive chat loop
     */
    const { rl, question } = createReadlineInterface();

    try {
      console.log("\nMCP客户端已启动！");
      console.log("输入您的问题或输入'quit'退出。");
      console.log("输入'debug'切换到调试模式，'info'切换到标准模式。");
      console.log("输入'tool:名称 [参数]'直接调用工具，例如 'tool:get-installed-apps'");

      while (true) {
        const message = await question("\n问题: ");

        // 处理特殊命令
        if (message.toLowerCase() === "quit") {
          break;
        } else if (message.toLowerCase() === "debug") {
          process.env.LOG_LEVEL = "debug";
          console.log("\n已切换到调试模式，将显示详细日志信息");
          continue;
        } else if (message.toLowerCase() === "info") {
          process.env.LOG_LEVEL = "info";
          console.log("\n已切换到标准模式，将只显示重要日志信息");
          continue;
        } else if (message.startsWith("tool:")) {
          // 直接工具调用模式
          try {
            const toolParts = message.substring(5).trim().split(" ");
            const toolName = toolParts[0];
            let args = {};

            if (toolParts.length > 1) {
              try {
                args = JSON.parse(toolParts.slice(1).join(" "));
              } catch (e) {
                logger.warn("无法解析参数JSON，使用空参数");
              }
            }

            const response = await this.directToolCall(toolName, args);
            console.log("\n" + response);
          } catch (error) {
            logger.error("直接工具调用失败", error);
            console.log(`\n直接工具调用失败: ${error instanceof Error ? error.message : String(error)}`);
          }
          continue;
        }

        try {
          logger.info("开始处理查询...");
          const response = await this.processQuery(message);
          logger.info("查询处理完成");
          console.log("\n" + response);
        } catch (error) {
          logger.error("处理消息时发生错误", error);
          console.log(`\n处理消息时发生错误: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      logger.error("聊天循环中发生错误", error);
      throw error;
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    try {
      logger.info("清理资源...");
      await this.mcp.close();
      logger.info("MCP客户端已关闭");
    } catch (error) {
      logger.error("清理资源时发生错误", error);
    }
  }
}

// 手动创建问答promise函数
function createReadlineInterface() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 扩展readline接口，添加promise版本的question方法
  const questionAsync = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  };

  return {
    rl,
    question: questionAsync,
    close: () => rl.close()
  };
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
      console.log("环境变量:");
      console.log("- LOG_LEVEL: 设置日志级别 (debug, info, warn, error)");

      // 检查环境变量中是否有MCP_SERVER_URL
      if (MCP_SERVER_URL) {
        logger.info(`检测到环境变量MCP_SERVER_URL: ${MCP_SERVER_URL}，尝试连接...`);
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
  } catch (error) {
    logger.error("程序运行时发生致命错误", error);
    process.exit(1);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();

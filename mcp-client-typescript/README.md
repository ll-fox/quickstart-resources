# MCP客户端 - OpenAI SDK连接DeepSeek

这是一个使用OpenAI SDK调用DeepSeek模型的Model Context Protocol (MCP)客户端实现。此客户端可以连接到MCP服务器，并使用DeepSeek模型处理用户查询和工具调用。

## 功能特点

- 使用OpenAI SDK连接DeepSeek模型
- 支持工具调用和结果处理
- 交互式命令行界面
- 支持连接本地和线上MCP服务器
- 支持WebSocket和SSE连接方式
- 易于配置和使用

## 安装

1. 克隆仓库并进入项目目录
2. 安装依赖

```bash
npm install
```

3. 创建`.env`文件并配置环境变量

```bash
cp .env.example .env
```

编辑`.env`文件，设置您的OpenAI API密钥、DeepSeek API端点和MCP服务器URL（如需要）：

```
OPENAI_API_KEY=your_openai_api_key_here
DEEPSEEK_API_BASE=https://api.deepseek.com/v1
MCP_SERVER_URL=ws://your-mcp-server-url  # 可选，用于自动连接线上MCP服务器
```

## 编译

```bash
npm run build
```

## 使用方法

### 连接本地MCP服务器脚本

```bash
npm run start path/to/server/script.py
```

### 连接线上WebSocket MCP服务器

```bash
npm run start -- --ws ws://example.com/mcp
```

### 连接线上SSE MCP服务器

```bash
npm run start -- --sse https://example.com/mcp
```

### 使用环境变量中的MCP服务器URL

如果您在.env文件中配置了MCP_SERVER_URL环境变量，则可以直接运行：

```bash
npm run start
```

客户端将自动尝试连接到环境变量中指定的MCP服务器。

### 开发模式

您也可以使用开发命令（先编译再运行）：

```bash
npm run dev path/to/server/script.py
# 或
npm run dev -- --ws ws://example.com/mcp
```

启动后，您可以输入问题与模型进行交互。如需退出，请输入`quit`。

## 自定义

如果您需要使用不同的DeepSeek模型，可以在`index.ts`文件中修改`model`参数。目前默认使用的是`deepseek-chat`模型。

```typescript
// 在processQuery方法中查找并修改
const response = await this.openai.chat.completions.create({
  model: "deepseek-chat", // 修改为您想要使用的DeepSeek模型
  // ...其他参数...
});
```

## 注意事项

- 您需要有效的OpenAI API密钥，该密钥有权限调用DeepSeek模型
- 确保您连接的MCP服务器正确实现了MCP协议
- 对于线上MCP服务器，请确保服务器支持WebSocket或SSE连接
- Node.js版本建议为v18或更高版本

## 排错

如果您遇到"找不到模块"的错误，请确保您已经正确安装了所有依赖：

```bash
npm install
```

如果API调用失败，请检查您的API密钥和网络连接是否正常。

如果连接线上MCP服务器失败，请检查服务器URL是否正确，以及服务器是否支持您选择的连接方式（WebSocket或SSE）。

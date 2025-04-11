import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getInstalledApps } from "get-installed-apps";
import { z } from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// 设置日志级别
const LOG_LEVEL = process.env.LOG_LEVEL || "info"; // debug, info, warn, error

// 日志工具函数
const logger = {
  debug: (message: string, ...args: any[]) => {
    if (LOG_LEVEL === "debug") {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") {
      console.error(`[INFO] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (LOG_LEVEL === "debug" || LOG_LEVEL === "info" || LOG_LEVEL === "warn") {
      console.error(`[WARN] ${message}`, ...args);
    }
  },
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`);
    if (error) {
      if (error instanceof Error) {
        console.error(`  - 错误名称: ${error.name}`);
        console.error(`  - 错误信息: ${error.message}`);
        console.error(`  - 错误堆栈: ${error.stack}`);
      } else {
        console.error(`  - 错误详情:`, error);
      }
    }
  }
};

/**
 * 用于向美国国家气象局(NWS)API发起请求的辅助函数
 * 
 * 该函数主要功能：
 * 1. 设置必要的请求头，包括User-Agent和Accept
 * 2. 添加500ms的初始延迟，防止请求速率过快
 * 3. 处理429 Too Many Requests错误，根据Retry-After头进行重试
 * 4. 处理其他HTTP错误
 * 5. 返回解析后的JSON数据或null（发生错误时）
 * 
 * @param url - 要请求的NWS API URL
 * @returns 返回解析后的JSON数据，类型为泛型T，如果发生错误则返回null
 */
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  // 设置请求头
  const headers = {
    "User-Agent": USER_AGENT, // 使用预定义的User-Agent
    Accept: "application/geo+json", // 指定接受的响应格式
  };

  try {
    logger.debug(`发起请求: ${url}`);

    // 添加500ms延迟，防止请求速率过快
    await new Promise(resolve => setTimeout(resolve, 500));

    // 发起fetch请求
    const response = await fetch(url, { headers });

    // 处理429 Too Many Requests错误
    if (response.status === 429) {
      // 获取Retry-After头，默认为5秒
      const retryAfter = response.headers.get('Retry-After') || '5';
      logger.warn(`请求速率受限，将在${retryAfter}秒后重试: ${url}`);
      // 根据Retry-After值进行延迟
      await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
      // 递归调用自身进行重试
      return makeNWSRequest(url);
    }

    // 处理其他HTTP错误
    if (!response.ok) {
      throw new Error(`HTTP错误！状态码: ${response.status}, URL: ${url}`);
    }

    // 返回解析后的JSON数据
    const data = await response.json();
    logger.debug(`请求成功: ${url}`);
    return data as T;
  } catch (error) {
    // 捕获并记录错误
    logger.error(`请求NWS API时发生错误: ${url}`, error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
    sent?: number;
  };
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `发布时间: ${new Date(props.sent || Date.now()).toLocaleString()}`,
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

// 封装工具处理函数，添加错误处理
const withErrorHandling = <T extends any[]>(toolName: string, handler: (...args: T) => Promise<any>) => {
  return async (...args: T) => {
    try {
      logger.debug(`执行工具: ${toolName}, 参数:`, args);
      const result = await handler(...args);
      logger.debug(`工具执行成功: ${toolName}`);
      return result;
    } catch (error) {
      logger.error(`工具执行失败: ${toolName}`, error);
      return {
        content: [
          {
            type: "text",
            text: `执行工具时发生错误: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  };
};

server.tool(
  "get-installed-apps",
  "Get my computer's installed apps",
  withErrorHandling("get-installed-apps", async () => {
    const apps = await getInstalledApps();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(apps, null, 2),
        },
      ],
    };
  })
);

// Register weather tools
server.tool(
  "get-alerts",
  "Get weather alerts for a state",
  {
    state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
  },
  withErrorHandling("get-alerts", async ({ state }) => {
    const stateCode = state.toUpperCase();
    logger.info(`获取州/省的天气警报: ${stateCode}`);

    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      logger.warn(`无法获取${stateCode}的警报数据`);
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      logger.info(`${stateCode}没有活动警报`);
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    logger.info(`${stateCode}找到${features.length}个活动警报`);
    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  }),
);

/**
 * 注册获取天气预报的工具
 * 
 * 该工具的主要功能：
 * 1. 接收用户输入的经纬度坐标
 * 2. 通过NWS API获取该位置的网格点数据
 * 3. 从网格点数据中提取天气预报URL
 * 4. 获取并格式化天气预报数据
 * 5. 返回格式化的天气预报信息
 * 
 * 参数说明：
 * - latitude: 纬度，范围限定在美国本土(24.396308°N - 49.384358°N)
 * - longitude: 经度，范围限定在美国本土(-124.848974°W - -66.885444°W)
 * 
 * 返回格式：
 * {
 *   content: [
 *     {
 *       type: "text",
 *       text: "格式化后的天气预报文本"
 *     }
 *   ]
 * }
 */
server.tool(
  "get-forecast",
  "获取指定位置的天气预报",
  {
    latitude: z.number()
      .min(24.396308).max(49.384358)  // 美国本土纬度范围
      .describe("位置的纬度（仅限美国本土）"),
    longitude: z.number()
      .min(-124.848974).max(-66.885444)  // 美国本土经度范围
      .describe("位置的经度（仅限美国本土）"),
  },
  withErrorHandling("get-forecast", async ({ latitude, longitude }) => {
    logger.info(`获取位置天气预报: (${latitude}, ${longitude})`);

    // 1. 获取网格点数据
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    // 处理网格点数据获取失败的情况
    if (!pointsData) {
      logger.warn(`无法获取坐标(${latitude}, ${longitude})的网格点数据`);
      return {
        content: [
          {
            type: "text",
            text: `无法获取坐标(${latitude}, ${longitude})的网格点数据。该位置可能不受NWS API支持（仅支持美国地区）。`,
          },
        ],
      };
    }

    // 2. 从网格点数据中提取天气预报URL
    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      logger.warn(`无法从网格点数据中获取天气预报URL: (${latitude}, ${longitude})`);
      return {
        content: [
          {
            type: "text",
            text: "无法从网格点数据中获取天气预报URL",
          },
        ],
      };
    }

    // 3. 获取天气预报数据
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      logger.warn(`无法获取天气预报数据: ${forecastUrl}`);
      return {
        content: [
          {
            type: "text",
            text: "无法获取天气预报数据",
          },
        ],
      };
    }

    // 4. 处理天气预报周期数据
    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      logger.warn(`没有可用的天气预报周期数据: (${latitude}, ${longitude})`);
      return {
        content: [
          {
            type: "text",
            text: "没有可用的天气预报周期数据",
          },
        ],
      };
    }

    // 5. 格式化每个预报周期
    logger.debug(`找到${periods.length}个预报周期: (${latitude}, ${longitude})`);
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "未知"}:`,
        `温度: ${period.temperature || "未知"}°${period.temperatureUnit || "F"}`,
        `风速: ${period.windSpeed || "未知"} ${period.windDirection || ""}`,
        `${period.shortForecast || "无可用预报"}`,
        "---",
      ].join("\n"),
    );

    // 6. 生成最终预报文本
    const forecastText = `位置(${latitude}, ${longitude})的天气预报:\n\n${formattedForecast.join("\n")}`;
    logger.info(`成功获取天气预报: (${latitude}, ${longitude})`);

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  }),
);

// Start the server
async function main() {
  try {
    logger.info("启动MCP服务器...");
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Weather MCP Server running on stdio");
  } catch (error) {
    logger.error("服务器启动失败", error);
    process.exit(1);
  }
}

// 添加未捕获异常处理
process.on('uncaughtException', (error) => {
  logger.error("未捕获的异常", error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error("未处理的Promise拒绝", reason);
});

main().catch((error) => {
  logger.error("主函数执行失败", error);
  process.exit(1);
});
